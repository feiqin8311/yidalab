import {
  type AgentRuntimeEvent,
  createSequenceAllocator,
  InMemoryOperationJournal,
  isJournalableEventType,
  mapWireEvent,
  type OperationJournal,
  type SequenceAllocator,
} from '@lobechat/agent-runtime';

import { appEnv } from '@/envs/app';

import { getSharedPostgresOperationJournal } from './PostgresOperationJournal';

/** Kill switch: AGENT_RUNTIME_PROTOCOL_JOURNAL=0 disables durable dual-write. */
export function isProtocolJournalEnabled(): boolean {
  return appEnv.enableAgentRuntimeProtocolJournal !== false;
}

/**
 * Server dual-path: map wire StreamEvent → protocol events, journal control plane only.
 *
 * Sequence for durable journal is allocated in Postgres (appendControlEvent).
 * Process-local SequenceAllocator is only for ephemeral map shapes before DB assign,
 * and for tests with explicit in-memory journals.
 *
 * High-frequency item_delta is NEVER written to PostgreSQL.
 */

const sequenceByOp = new Map<string, SequenceAllocator>();

export function getOrCreateSequenceAllocator(
  operationId: string,
  startAfter?: number,
): SequenceAllocator {
  let seq = sequenceByOp.get(operationId);
  if (!seq) {
    seq = createSequenceAllocator(startAfter ?? 0);
    sequenceByOp.set(operationId, seq);
  }
  return seq;
}

/** Test / process teardown helper. */
export function resetProtocolSequenceAllocators(): void {
  sequenceByOp.clear();
}

export interface MapAndMaybeJournalInput {
  data?: unknown;
  id?: string;
  /** When omitted, uses shared Postgres journal. Pass null to skip durable write. */
  journal?: OperationJournal | null;
  operationId: string;
  stepIndex: number;
  timestamp?: number;
  type: string;
}

/**
 * Map a wire stream event into protocol events and append control events to journal.
 *
 * Durable path (default journal):
 * - Maps wire → protocol with provisional sequence
 * - For each journalable event, appendControlEvent assigns atomic DB sequence
 * - Non-journalable (item_delta) skipped for PG
 * - Append failures propagate to caller (StreamEventManager must log, not swallow as success)
 */
export async function mapWireEventToProtocolAndJournal(
  input: MapAndMaybeJournalInput,
): Promise<AgentRuntimeEvent[]> {
  const sequences = getOrCreateSequenceAllocator(input.operationId);
  const mapped = mapWireEvent(
    {
      data: input.data,
      id: input.id,
      operationId: input.operationId,
      stepIndex: input.stepIndex,
      timestamp: input.timestamp ?? Date.now(),
      type: input.type,
    },
    { operationId: input.operationId, sequences, wireEventId: input.id },
  );

  if (input.journal === null) {
    return mapped;
  }

  // Kill switch: map only, no Postgres append (Redis wire still works).
  if (input.journal === undefined && !isProtocolJournalEnabled()) {
    return mapped;
  }

  const journal = input.journal ?? getSharedPostgresOperationJournal();
  const out: AgentRuntimeEvent[] = [];

  for (const event of mapped) {
    if (!isJournalableEventType(event.type)) {
      out.push(event);
      continue;
    }

    // Prefer atomic append when Postgres journal is used.
    if (hasAppendControlEvent(journal)) {
      const result = await journal.appendControlEvent(event);
      out.push({
        ...event,
        meta: {
          ...event.meta,
          eventId: result.eventId,
          sequence: result.sequence,
        },
      } as AgentRuntimeEvent);
    } else {
      await journal.appendIdempotent({ event });
      out.push(event);
    }
  }

  return out;
}

function hasAppendControlEvent(journal: OperationJournal): journal is OperationJournal & {
  appendControlEvent: (
    e: AgentRuntimeEvent,
  ) => Promise<{ sequence: number; eventId: string; inserted: boolean }>;
} {
  return typeof (journal as { appendControlEvent?: unknown }).appendControlEvent === 'function';
}

export function createServerProtocolJournal(): InMemoryOperationJournal {
  return new InMemoryOperationJournal();
}

export { getSharedPostgresOperationJournal };
