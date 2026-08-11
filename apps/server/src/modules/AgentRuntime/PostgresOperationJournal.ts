import {
  type AgentRuntimeEvent,
  eventToJournalRecord,
  isJournalableEventType,
  type OperationJournal,
  type OperationJournalRecord,
  type ReadJournalQuery,
  type Sequence,
} from '@lobechat/agent-runtime';
import debug from 'debug';

import { AgentRuntimeProtocolModel } from '@/database/models/agentRuntimeProtocol';
import { getServerDB } from '@/database/server';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:agent-runtime:postgres-journal');

export interface ControlAppendResult {
  eventId: string;
  inserted: boolean;
  /** Sequence assigned by Postgres (authoritative). */
  sequence: Sequence;
  skipped?: 'not_journalable' | 'duplicate';
}

/**
 * Durable OperationJournal backed by agent_runtime_journal.
 *
 * - Sequence is allocated atomically in Postgres (multi-instance safe).
 * - Only control-plane events are persisted (isJournalableEventType).
 * - item_delta / stream chunks are NEVER written here.
 */
export class PostgresOperationJournal implements OperationJournal {
  private model: AgentRuntimeProtocolModel | null = null;

  constructor(private readonly db?: LobeChatDatabase) {}

  private async getModel(): Promise<AgentRuntimeProtocolModel> {
    if (this.model) return this.model;
    const database = this.db ?? (await getServerDB());
    this.model = new AgentRuntimeProtocolModel(database);
    return this.model;
  }

  async append(input: { event: AgentRuntimeEvent }): Promise<OperationJournalRecord> {
    return this.appendIdempotent(input);
  }

  /**
   * Append control event with DB-authoritative sequence.
   * Replaces process-local sequence on the event with the DB-assigned value.
   */
  async appendIdempotent(input: { event: AgentRuntimeEvent }): Promise<OperationJournalRecord> {
    const result = await this.appendControlEvent(input.event);
    return {
      createdAt: new Date(input.event.meta.timestamp),
      eventId: result.eventId,
      operationId: input.event.meta.operationId,
      payload: 'payload' in input.event ? input.event.payload : undefined,
      sequence: result.sequence,
      stepId: 'stepId' in input.event.meta ? input.event.meta.stepId : undefined,
      turnId: 'turnId' in input.event.meta ? input.event.meta.turnId : undefined,
      type: input.event.type,
    };
  }

  /**
   * Preferred API: only journalable types; atomic sequence; returns DB sequence.
   */
  async appendControlEvent(event: AgentRuntimeEvent): Promise<ControlAppendResult> {
    if (!isJournalableEventType(event.type)) {
      return {
        eventId: event.meta.eventId,
        inserted: false,
        sequence: event.meta.sequence,
        skipped: 'not_journalable',
      };
    }

    const model = await this.getModel();
    const turnId = 'turnId' in event.meta ? event.meta.turnId : undefined;
    const stepId = 'stepId' in event.meta ? event.meta.stepId : undefined;

    try {
      const result = await model.appendJournalAtomic({
        eventId: event.meta.eventId,
        eventTimestamp: new Date(event.meta.timestamp),
        operationId: event.meta.operationId,
        payload: 'payload' in event ? event.payload : undefined,
        stepId,
        turnId,
        type: event.type,
      });

      if (result.inserted) {
        return {
          eventId: result.row.eventId,
          inserted: true,
          sequence: result.row.sequence,
        };
      }

      // inserted: false — reason is narrowed here
      if (result.reason === 'event_id_conflict' && result.row) {
        return {
          eventId: result.row.eventId,
          inserted: false,
          sequence: result.row.sequence,
          skipped: 'duplicate',
        };
      }

      throw new Error(
        `Journal append failed for ${event.meta.operationId}/${event.meta.eventId}: ${result.reason}`,
      );
    } catch (error) {
      log('appendControlEvent failed for %s %s: %o', event.meta.operationId, event.type, error);
      throw error;
    }
  }

  async read(query: ReadJournalQuery): Promise<OperationJournalRecord[]> {
    const model = await this.getModel();
    const rows = await model.readJournal({
      afterSequence: query.afterSequence,
      limit: query.limit,
      operationId: query.operationId,
    });
    return rows.map((row) => ({
      createdAt: row.eventTimestamp,
      eventId: row.eventId,
      operationId: row.operationId,
      payload: row.payload,
      sequence: row.sequence,
      stepId: row.stepId ?? undefined,
      turnId: row.turnId ?? undefined,
      type: row.type as OperationJournalRecord['type'],
    }));
  }

  async getLastSequence(operationId: string): Promise<Sequence> {
    const model = await this.getModel();
    return model.getLastJournalSequence(operationId);
  }
}

let sharedJournal: PostgresOperationJournal | null = null;

/** Process-level journal for stream dual-write (no request userId). */
export function getSharedPostgresOperationJournal(): PostgresOperationJournal {
  if (!sharedJournal) sharedJournal = new PostgresOperationJournal();
  return sharedJournal;
}

// re-export helper used by tests
export { eventToJournalRecord };
