import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';

import type {
  NewAgentRuntimeCheckpoint,
  NewAgentRuntimeExecutionEdge,
  NewAgentRuntimeIntervention,
  NewAgentRuntimeJournal,
} from '../schemas/agentRuntimeJournal';
import {
  agentRuntimeCheckpoints,
  agentRuntimeExecutionEdges,
  agentRuntimeInterventions,
  agentRuntimeJournal,
} from '../schemas/agentRuntimeJournal';
import type { LobeChatDatabase } from '../type';
import { createNanoId } from '../utils/idGenerator';

const nanoId = createNanoId(16);

export type JournalAppendResult =
  | { inserted: true; row: NewAgentRuntimeJournal }
  | {
      inserted: false;
      reason: 'event_id_conflict' | 'sequence_conflict';
      row?: NewAgentRuntimeJournal;
    };

export type InterventionRequestResult =
  | { ok: true; created: boolean; status: 'pending' | 'resolved' | 'cancelled' }
  | { ok: false; error: string };

export type InterventionResolveResult =
  | { ok: true; duplicate: boolean; status: 'resolved' }
  | { ok: false; error: 'not_found' | 'cancelled' | 'operation_mismatch' | string };

/**
 * Persistence for unified Agent Runtime Protocol tables.
 * No userId on rows — ownership is via agent_operations FK.
 *
 * Critical invariants:
 * - Journal sequence is allocated atomically in Postgres (not process Map).
 * - Intervention request never overwrites resolved/cancelled.
 * - Intervention resolve is UPDATE ... WHERE status='pending' only.
 */
export class AgentRuntimeProtocolModel {
  constructor(private readonly db: LobeChatDatabase) {}

  // ─── Journal ───

  /**
   * Atomically allocate next sequence and insert a control-plane journal row.
   * Idempotent on (operation_id, event_id): returns existing without new sequence.
   *
   * Sequence comes from agent_runtime_journal_counters via
   * INSERT ... ON CONFLICT DO UPDATE ... RETURNING — never MAX(sequence)+1.
   * Gaps are allowed (e.g. after a lost race on event_id).
   */
  async appendJournalAtomic(params: {
    eventId: string;
    eventTimestamp: Date;
    operationId: string;
    payload?: unknown;
    stepId?: string | null;
    turnId?: string | null;
    type: string;
    id?: string;
  }): Promise<JournalAppendResult> {
    const id = params.id ?? `arj_${nanoId()}`;

    // Fast path: already have this eventId (no counter bump)
    const existing = await this.findJournalByEventId(params.operationId, params.eventId);
    if (existing) {
      return {
        inserted: false,
        reason: 'event_id_conflict',
        row: existing,
      };
    }

    try {
      // Claim next sequence from per-operation counter, then insert journal row.
      // ON CONFLICT (event_id) DO NOTHING handles same-eventId races after counter bump.
      const result = await this.db.execute(sql`
        WITH claimed AS (
          INSERT INTO agent_runtime_journal_counters (operation_id, next_sequence)
          VALUES (${params.operationId}, 2)
          ON CONFLICT (operation_id) DO UPDATE
          SET
            next_sequence = agent_runtime_journal_counters.next_sequence + 1,
            updated_at = NOW()
          RETURNING next_sequence - 1 AS sequence
        )
        INSERT INTO agent_runtime_journal (
          id, operation_id, event_id, sequence, type, payload, turn_id, step_id, event_timestamp
        )
        SELECT
          ${id},
          ${params.operationId},
          ${params.eventId},
          claimed.sequence,
          ${params.type},
          ${params.payload === undefined ? null : JSON.stringify(params.payload)}::jsonb,
          ${params.turnId ?? null},
          ${params.stepId ?? null},
          ${params.eventTimestamp}
        FROM claimed
        ON CONFLICT (operation_id, event_id) DO NOTHING
        RETURNING id, operation_id, event_id, sequence, type, payload, turn_id, step_id, event_timestamp
      `);

      const rows = (result as { rows?: Record<string, unknown>[] }).rows ?? [];
      if (rows.length === 0) {
        // Same eventId won the race (or unique index name differs — re-read)
        const again = await this.findJournalByEventId(params.operationId, params.eventId);
        if (again) {
          return { inserted: false, reason: 'event_id_conflict', row: again };
        }
        return { inserted: false, reason: 'sequence_conflict' };
      }

      const r = rows[0]!;
      return {
        inserted: true,
        row: {
          id: String(r.id),
          operationId: String(r.operation_id),
          eventId: String(r.event_id),
          sequence: Number(r.sequence),
          type: String(r.type),
          payload: r.payload,
          turnId: r.turn_id == null ? null : String(r.turn_id),
          stepId: r.step_id == null ? null : String(r.step_id),
          eventTimestamp: new Date(String(r.event_timestamp)),
        },
      };
    } catch (error) {
      // Unique violation on event_id — re-read
      const again = await this.findJournalByEventId(params.operationId, params.eventId);
      if (again) {
        return { inserted: false, reason: 'event_id_conflict', row: again };
      }
      throw error;
    }
  }

  /** @deprecated Use appendJournalAtomic — process-local sequence is unsafe multi-instance. */
  async appendJournalIdempotent(
    row: Omit<NewAgentRuntimeJournal, 'id'> & { id?: string },
  ): Promise<NewAgentRuntimeJournal> {
    const result = await this.appendJournalAtomic({
      eventId: row.eventId,
      eventTimestamp: row.eventTimestamp,
      id: row.id,
      operationId: row.operationId,
      payload: row.payload,
      stepId: row.stepId,
      turnId: row.turnId,
      type: row.type,
    });
    if (result.row) return result.row as NewAgentRuntimeJournal;
    // Fallback insert with provided sequence only for tests that need exact sequence
    const values: NewAgentRuntimeJournal = {
      id: row.id ?? `arj_${nanoId()}`,
      ...row,
    };
    await this.db.insert(agentRuntimeJournal).values(values).onConflictDoNothing();
    return values;
  }

  private async findJournalByEventId(operationId: string, eventId: string) {
    const [row] = await this.db
      .select()
      .from(agentRuntimeJournal)
      .where(
        and(
          eq(agentRuntimeJournal.operationId, operationId),
          eq(agentRuntimeJournal.eventId, eventId),
        ),
      )
      .limit(1);
    return row ?? undefined;
  }

  async readJournal(params: {
    afterSequence?: number;
    limit?: number;
    operationId: string;
  }): Promise<(typeof agentRuntimeJournal.$inferSelect)[]> {
    const after = params.afterSequence ?? 0;
    const query = this.db
      .select()
      .from(agentRuntimeJournal)
      .where(
        and(
          eq(agentRuntimeJournal.operationId, params.operationId),
          gt(agentRuntimeJournal.sequence, after),
        ),
      )
      .orderBy(asc(agentRuntimeJournal.sequence));

    if (params.limit !== undefined) {
      return query.limit(params.limit);
    }
    return query;
  }

  async getLastJournalSequence(operationId: string): Promise<number> {
    const [row] = await this.db
      .select({ sequence: agentRuntimeJournal.sequence })
      .from(agentRuntimeJournal)
      .where(eq(agentRuntimeJournal.operationId, operationId))
      .orderBy(desc(agentRuntimeJournal.sequence))
      .limit(1);
    return row?.sequence ?? 0;
  }

  // ─── Checkpoints ───

  async saveCheckpoint(
    row: Omit<NewAgentRuntimeCheckpoint, 'id'> & { id?: string },
  ): Promise<NewAgentRuntimeCheckpoint> {
    const values: NewAgentRuntimeCheckpoint = {
      id: row.id ?? `arc_${nanoId()}`,
      ...row,
    };
    await this.db.insert(agentRuntimeCheckpoints).values(values).onConflictDoNothing();
    return values;
  }

  async loadLatestCheckpoint(operationId: string) {
    const [row] = await this.db
      .select()
      .from(agentRuntimeCheckpoints)
      .where(eq(agentRuntimeCheckpoints.operationId, operationId))
      .orderBy(desc(agentRuntimeCheckpoints.sequence))
      .limit(1);
    return row ?? null;
  }

  async loadCheckpointAtOrBefore(operationId: string, sequence: number) {
    const [row] = await this.db
      .select()
      .from(agentRuntimeCheckpoints)
      .where(
        and(
          eq(agentRuntimeCheckpoints.operationId, operationId),
          sql`${agentRuntimeCheckpoints.sequence} <= ${sequence}`,
        ),
      )
      .orderBy(desc(agentRuntimeCheckpoints.sequence))
      .limit(1);
    return row ?? null;
  }

  async listCheckpoints(operationId: string) {
    return this.db
      .select()
      .from(agentRuntimeCheckpoints)
      .where(eq(agentRuntimeCheckpoints.operationId, operationId))
      .orderBy(asc(agentRuntimeCheckpoints.sequence));
  }

  // ─── Interventions ───

  /**
   * Request: INSERT only. Never overwrites resolved/cancelled.
   * ON CONFLICT DO NOTHING — if already present, leave status unchanged.
   */
  async requestIntervention(
    row: Omit<
      NewAgentRuntimeIntervention,
      'id' | 'status' | 'response' | 'resolvedAt' | 'resolvedByCommandId'
    > & {
      id?: string;
    },
  ): Promise<InterventionRequestResult> {
    const values: NewAgentRuntimeIntervention = {
      id: row.id ?? `ari_${nanoId()}`,
      ...row,
      status: 'pending',
    };

    await this.db.insert(agentRuntimeInterventions).values(values).onConflictDoNothing();

    const current = await this.findIntervention(row.operationId, row.interventionId);
    if (!current) {
      return { ok: false, error: 'insert_failed' };
    }
    return {
      ok: true,
      created: current.status === 'pending' && !current.resolvedByCommandId,
      status: current.status as 'pending' | 'resolved' | 'cancelled',
    };
  }

  /**
   * Resolve: UPDATE only where status='pending'. Idempotent when already resolved
   * by the same or any commandId (returns duplicate).
   * Does NOT insert a fake row when intervention is missing.
   */
  async resolveIntervention(params: {
    commandId: string;
    interventionId: string;
    operationId: string;
    resolution: unknown;
  }): Promise<InterventionResolveResult> {
    const existing = await this.findIntervention(params.operationId, params.interventionId);
    if (!existing) {
      return { ok: false, error: 'not_found' };
    }
    if (existing.status === 'resolved') {
      return { ok: true, duplicate: true, status: 'resolved' };
    }
    if (existing.status === 'cancelled') {
      return { ok: false, error: 'cancelled' };
    }

    const updated = await this.db
      .update(agentRuntimeInterventions)
      .set({
        status: 'resolved',
        response: params.resolution,
        resolvedByCommandId: params.commandId,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentRuntimeInterventions.operationId, params.operationId),
          eq(agentRuntimeInterventions.interventionId, params.interventionId),
          eq(agentRuntimeInterventions.status, 'pending'),
        ),
      )
      .returning({ id: agentRuntimeInterventions.id });

    if (updated.length === 0) {
      // Lost race — re-read
      const again = await this.findIntervention(params.operationId, params.interventionId);
      if (again?.status === 'resolved') {
        return { ok: true, duplicate: true, status: 'resolved' };
      }
      if (again?.status === 'cancelled') {
        return { ok: false, error: 'cancelled' };
      }
      return { ok: false, error: 'not_found' };
    }

    return { ok: true, duplicate: false, status: 'resolved' };
  }

  /** @deprecated Prefer requestIntervention / resolveIntervention */
  async upsertIntervention(
    row: Omit<NewAgentRuntimeIntervention, 'id'> & { id?: string },
  ): Promise<NewAgentRuntimeIntervention> {
    if (row.status === 'pending') {
      await this.requestIntervention({
        createdAtEvent: row.createdAtEvent,
        id: row.id,
        interventionId: row.interventionId,
        operationId: row.operationId,
        request: row.request,
        stepId: row.stepId,
        type: row.type,
      });
      const found = await this.findIntervention(row.operationId, row.interventionId);
      return (
        (found as NewAgentRuntimeIntervention) ??
        ({ ...row, id: row.id ?? '' } as NewAgentRuntimeIntervention)
      );
    }
    if (row.status === 'resolved' && row.resolvedByCommandId) {
      await this.resolveIntervention({
        commandId: row.resolvedByCommandId,
        interventionId: row.interventionId,
        operationId: row.operationId,
        resolution: row.response,
      });
      const found = await this.findIntervention(row.operationId, row.interventionId);
      return (
        (found as NewAgentRuntimeIntervention) ??
        ({ ...row, id: row.id ?? '' } as NewAgentRuntimeIntervention)
      );
    }
    // cancel path
    const values: NewAgentRuntimeIntervention = {
      id: row.id ?? `ari_${nanoId()}`,
      ...row,
    };
    await this.db.insert(agentRuntimeInterventions).values(values).onConflictDoNothing();
    return values;
  }

  async findIntervention(operationId: string, interventionId: string) {
    const [row] = await this.db
      .select()
      .from(agentRuntimeInterventions)
      .where(
        and(
          eq(agentRuntimeInterventions.operationId, operationId),
          eq(agentRuntimeInterventions.interventionId, interventionId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async listPendingInterventions(operationId: string) {
    return this.db
      .select()
      .from(agentRuntimeInterventions)
      .where(
        and(
          eq(agentRuntimeInterventions.operationId, operationId),
          eq(agentRuntimeInterventions.status, 'pending'),
        ),
      );
  }

  async cancelPendingInterventions(operationId: string, reason?: string) {
    await this.db
      .update(agentRuntimeInterventions)
      .set({
        status: 'cancelled',
        response: reason ? { reason } : undefined,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentRuntimeInterventions.operationId, operationId),
          eq(agentRuntimeInterventions.status, 'pending'),
        ),
      );
  }

  // ─── Execution edges (subagent graph) ───

  async openExecutionEdge(
    row: Omit<NewAgentRuntimeExecutionEdge, 'id' | 'status'> & {
      id?: string;
      status?: NewAgentRuntimeExecutionEdge['status'];
    },
  ): Promise<void> {
    await this.db
      .insert(agentRuntimeExecutionEdges)
      .values({
        id: row.id ?? `are_${nanoId()}`,
        parentOperationId: row.parentOperationId,
        childOperationId: row.childOperationId,
        callId: row.callId,
        relationship: row.relationship,
        status: row.status ?? 'open',
      })
      .onConflictDoNothing();
  }

  async closeExecutionEdge(
    childOperationId: string,
    status: 'completed' | 'failed' | 'cancelled',
  ): Promise<void> {
    await this.db
      .update(agentRuntimeExecutionEdges)
      .set({
        status,
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentRuntimeExecutionEdges.childOperationId, childOperationId));
  }

  async getChildEdges(parentOperationId: string) {
    return this.db
      .select()
      .from(agentRuntimeExecutionEdges)
      .where(eq(agentRuntimeExecutionEdges.parentOperationId, parentOperationId));
  }

  async getParentEdge(childOperationId: string) {
    const [row] = await this.db
      .select()
      .from(agentRuntimeExecutionEdges)
      .where(eq(agentRuntimeExecutionEdges.childOperationId, childOperationId))
      .limit(1);
    return row ?? null;
  }
}
