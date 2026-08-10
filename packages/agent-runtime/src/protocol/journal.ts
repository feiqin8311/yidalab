import type { AgentRuntimeEvent, AgentRuntimeEventType } from './events';
import type { EventId, OperationId, Sequence, StepId, TurnId } from './ids';

/**
 * Append-only Operation Journal record.
 *
 * Product tables (messages, agent_operations) remain projections.
 * Journal is the authority for sequence + reconnect (SubscribeOperation).
 */
export interface OperationJournalRecord {
  /** Wall-clock when the event was appended. */
  createdAt: Date;
  eventId: EventId;
  operationId: OperationId;
  payload: unknown;
  sequence: Sequence;
  stepId?: StepId;
  turnId?: TurnId;
  type: AgentRuntimeEventType;
}

export interface AppendJournalInput {
  event: AgentRuntimeEvent;
}

export interface ReadJournalQuery {
  /** Exclusive lower bound — deliver sequence > afterSequence. */
  afterSequence?: Sequence;
  limit?: number;
  operationId: OperationId;
}

/**
 * Durable journal port. Postgres implementation lives in apps/server / packages/database.
 * InMemoryOperationJournal is for tests and client dual-path until durability lands.
 */
export interface OperationJournal {
  append: (input: AppendJournalInput) => Promise<OperationJournalRecord>;
  /**
   * Idempotent append: if (operationId, eventId) exists, return existing row
   * without increasing sequence.
   */
  appendIdempotent: (input: AppendJournalInput) => Promise<OperationJournalRecord>;
  getLastSequence: (operationId: OperationId) => Promise<Sequence>;
  read: (query: ReadJournalQuery) => Promise<OperationJournalRecord[]>;
}

export function eventToJournalRecord(event: AgentRuntimeEvent): OperationJournalRecord {
  const turnId = 'turnId' in event.meta ? event.meta.turnId : undefined;
  const stepId = 'stepId' in event.meta ? event.meta.stepId : undefined;
  return {
    createdAt: new Date(event.meta.timestamp),
    eventId: event.meta.eventId,
    operationId: event.meta.operationId,
    payload: 'payload' in event ? event.payload : undefined,
    sequence: event.meta.sequence,
    stepId,
    turnId,
    type: event.type,
  };
}

/**
 * In-memory journal: enforces (operationId, sequence) uniqueness and
 * (operationId, eventId) idempotency. Not process-crash safe.
 */
export class InMemoryOperationJournal implements OperationJournal {
  private readonly byOp = new Map<OperationId, OperationJournalRecord[]>();
  private readonly eventIndex = new Map<string, OperationJournalRecord>();

  private key(operationId: OperationId, eventId: EventId): string {
    return `${operationId}\0${eventId}`;
  }

  async append(input: AppendJournalInput): Promise<OperationJournalRecord> {
    const record = eventToJournalRecord(input.event);
    const rows = this.byOp.get(record.operationId) ?? [];
    if (rows.some((r) => r.sequence === record.sequence)) {
      throw new Error(`Journal sequence conflict: ${record.operationId}#${record.sequence}`);
    }
    const idKey = this.key(record.operationId, record.eventId);
    if (this.eventIndex.has(idKey)) {
      throw new Error(`Journal eventId conflict: ${record.operationId}/${record.eventId}`);
    }
    rows.push(record);
    rows.sort((a, b) => a.sequence - b.sequence);
    this.byOp.set(record.operationId, rows);
    this.eventIndex.set(idKey, record);
    return record;
  }

  async appendIdempotent(input: AppendJournalInput): Promise<OperationJournalRecord> {
    const record = eventToJournalRecord(input.event);
    const idKey = this.key(record.operationId, record.eventId);
    const existing = this.eventIndex.get(idKey);
    if (existing) return existing;
    return this.append(input);
  }

  async read(query: ReadJournalQuery): Promise<OperationJournalRecord[]> {
    const after = query.afterSequence ?? 0;
    const rows = this.byOp.get(query.operationId) ?? [];
    const filtered = rows.filter((r) => r.sequence > after);
    return query.limit ? filtered.slice(0, query.limit) : filtered;
  }

  async getLastSequence(operationId: OperationId): Promise<Sequence> {
    const rows = this.byOp.get(operationId) ?? [];
    if (rows.length === 0) return 0;
    return rows.at(-1)!.sequence;
  }
}
