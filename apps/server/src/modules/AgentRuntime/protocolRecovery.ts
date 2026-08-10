import type {
  AgentCheckpoint,
  AgentRuntimeEvent,
  Intervention,
  OperationJournalRecord,
  PendingToolCall,
} from '@lobechat/agent-runtime';
import { toolIdempotencyKey } from '@lobechat/agent-runtime';
import debug from 'debug';

import { AgentRuntimeProtocolModel } from '@/database/models/agentRuntimeProtocol';
import { getServerDB } from '@/database/server';
import type { LobeChatDatabase } from '@/database/type';

import { PostgresOperationJournal } from './PostgresOperationJournal';

const log = debug('lobe-server:agent-runtime:protocol-recovery');

/**
 * SubscribeOperation read path: replay journal events after a sequence.
 * Does NOT resume execution — transport reconnect only.
 */
export async function subscribeOperationEvents(params: {
  afterSequence: number;
  db?: LobeChatDatabase;
  limit?: number;
  operationId: string;
}): Promise<OperationJournalRecord[]> {
  const journal = new PostgresOperationJournal(params.db);
  return journal.read({
    afterSequence: params.afterSequence,
    limit: params.limit ?? 2000,
    operationId: params.operationId,
  });
}

/**
 * Load latest checkpoint for recovery planning.
 * Tool re-execution must check pendingCalls[].result / status first.
 */
export async function loadRecoveryCheckpoint(params: {
  atOrBeforeSequence?: number;
  db?: LobeChatDatabase;
  operationId: string;
}): Promise<AgentCheckpoint | null> {
  const db = params.db ?? (await getServerDB());
  const model = new AgentRuntimeProtocolModel(db);
  const row =
    params.atOrBeforeSequence === undefined
      ? await model.loadLatestCheckpoint(params.operationId)
      : await model.loadCheckpointAtOrBefore(params.operationId, params.atOrBeforeSequence);

  if (!row) return null;

  return {
    agentState: row.agentState,
    contextManifest: row.contextManifest as AgentCheckpoint['contextManifest'],
    createdAt: row.createdAtEvent.getTime(),
    operationId: row.operationId,
    pendingCalls: (row.pendingCalls as PendingToolCall[]) ?? [],
    pendingIntervention: row.pendingIntervention as AgentCheckpoint['pendingIntervention'],
    reason: row.reason ?? undefined,
    sequence: row.sequence,
    stepId: row.stepId,
  };
}

export async function saveRecoveryCheckpoint(params: {
  checkpoint: AgentCheckpoint;
  db?: LobeChatDatabase;
}): Promise<void> {
  const db = params.db ?? (await getServerDB());
  const model = new AgentRuntimeProtocolModel(db);
  const { checkpoint } = params;
  await model.saveCheckpoint({
    agentState: checkpoint.agentState,
    contextManifest: checkpoint.contextManifest,
    createdAtEvent: new Date(checkpoint.createdAt),
    operationId: checkpoint.operationId,
    pendingCalls: checkpoint.pendingCalls,
    pendingIntervention: checkpoint.pendingIntervention,
    reason: checkpoint.reason,
    sequence: checkpoint.sequence,
    stepId: checkpoint.stepId,
  });
}

/**
 * Build pending tool call entries with idempotency keys.
 * On resume: if status is completed/failed, do not re-execute.
 */
export function buildPendingToolCalls(params: {
  operationId: string;
  stepId: string;
  toolCalls: Array<{ arguments: string; name: string; toolCallId: string }>;
}): PendingToolCall[] {
  return params.toolCalls.map((tc) => ({
    arguments: tc.arguments,
    idempotencyKey: toolIdempotencyKey(params.operationId, params.stepId, tc.toolCallId),
    name: tc.name,
    status: 'pending' as const,
    toolCallId: tc.toolCallId,
  }));
}

/**
 * Persist intervention request (HIL).
 * INSERT only — never overwrites resolved/cancelled (no resolved→pending race).
 * Failures are returned to the caller — do not swallow; park must not become
 * approvable until this succeeds.
 */
export async function persistInterventionRequest(params: {
  db?: LobeChatDatabase;
  intervention: Omit<Intervention, 'status' | 'response' | 'resolvedAt' | 'resolvedByCommandId'>;
}): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  const db = params.db ?? (await getServerDB());
  const model = new AgentRuntimeProtocolModel(db);
  try {
    const result = await model.requestIntervention({
      createdAtEvent: new Date(params.intervention.createdAt),
      interventionId: params.intervention.interventionId,
      operationId: params.intervention.operationId,
      request: params.intervention.request,
      stepId: params.intervention.stepId,
      type: params.intervention.type,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, created: result.created };
  } catch (error) {
    log('persistInterventionRequest failed: %o', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'request_failed',
    };
  }
}

/**
 * Resolve intervention with commandId idempotency.
 * UPDATE WHERE status='pending' only. Never inserts a pseudo-row when missing.
 */
export async function persistInterventionResolve(params: {
  commandId: string;
  db?: LobeChatDatabase;
  interventionId: string;
  operationId: string;
  resolution: unknown;
}): Promise<{ duplicate: boolean; ok: boolean; error?: string }> {
  const db = params.db ?? (await getServerDB());
  const model = new AgentRuntimeProtocolModel(db);
  try {
    const result = await model.resolveIntervention({
      commandId: params.commandId,
      interventionId: params.interventionId,
      operationId: params.operationId,
      resolution: params.resolution,
    });
    if (!result.ok) {
      return { duplicate: false, error: result.error, ok: false };
    }
    return { duplicate: result.duplicate, ok: true };
  } catch (error) {
    log('persistInterventionResolve failed: %o', error);
    return { duplicate: false, error: 'db_error', ok: false };
  }
}

export async function cancelInterventionsForOperation(params: {
  db?: LobeChatDatabase;
  operationId: string;
  reason?: string;
}): Promise<void> {
  const db = params.db ?? (await getServerDB());
  const model = new AgentRuntimeProtocolModel(db);
  try {
    await model.cancelPendingInterventions(params.operationId, params.reason);
  } catch (error) {
    log('cancelInterventionsForOperation failed: %o', error);
  }
}

/**
 * Open a sub-agent graph edge (non-fatal).
 */
export async function openSubagentEdge(params: {
  callId: string;
  childOperationId: string;
  db?: LobeChatDatabase;
  parentOperationId: string;
  relationship?: 'spawn' | 'delegate' | 'handoff';
}): Promise<void> {
  const db = params.db ?? (await getServerDB());
  const model = new AgentRuntimeProtocolModel(db);
  try {
    await model.openExecutionEdge({
      callId: params.callId,
      childOperationId: params.childOperationId,
      parentOperationId: params.parentOperationId,
      relationship: params.relationship ?? 'spawn',
    });
  } catch (error) {
    log('openSubagentEdge failed: %o', error);
  }
}

export async function closeSubagentEdge(params: {
  childOperationId: string;
  db?: LobeChatDatabase;
  status: 'completed' | 'failed' | 'cancelled';
}): Promise<void> {
  const db = params.db ?? (await getServerDB());
  const model = new AgentRuntimeProtocolModel(db);
  try {
    await model.closeExecutionEdge(params.childOperationId, params.status);
  } catch (error) {
    log('closeSubagentEdge failed: %o', error);
  }
}

/** Reconstruct protocol event types from journal rows (for replay consumers). */
export function journalRecordsToEventSummaries(
  records: OperationJournalRecord[],
): Array<{ sequence: number; type: AgentRuntimeEvent['type']; eventId: string }> {
  return records.map((r) => ({
    eventId: r.eventId,
    sequence: r.sequence,
    type: r.type,
  }));
}
