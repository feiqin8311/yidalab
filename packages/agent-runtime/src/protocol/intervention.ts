import type { CommandId, InterventionId, OperationId, StepId } from './ids';

/**
 * Durable intervention state machine (PR8 types + pure transitions).
 * Persistence adapters wire these into DB / Redis later.
 */

/** Protocol-level operation status (distinct from product AgentState.status). */
export type ProtocolOperationStatus =
  'running' | 'waiting_for_approval' | 'waiting_for_input' | 'interrupted' | 'completed' | 'failed';

/** @deprecated Use ProtocolOperationStatus */
export type OperationStatus = ProtocolOperationStatus;

export type InterventionKind = 'approval' | 'input' | 'selection';
export type InterventionStatus = 'pending' | 'resolved' | 'cancelled';

export interface Intervention {
  createdAt: number;
  interventionId: InterventionId;
  operationId: OperationId;
  request: unknown;
  resolvedAt?: number;
  /** First commandId that resolved this intervention (idempotency). */
  resolvedByCommandId?: CommandId;
  response?: unknown;
  status: InterventionStatus;
  stepId: StepId;
  type: InterventionKind;
}

export type InterventionTransition =
  | {
      type: 'request';
      intervention: Omit<
        Intervention,
        'status' | 'resolvedAt' | 'resolvedByCommandId' | 'response'
      >;
    }
  | {
      type: 'resolve';
      commandId: CommandId;
      interventionId: InterventionId;
      operationId: OperationId;
      resolution: unknown;
    }
  | {
      type: 'cancel';
      interventionId: InterventionId;
      operationId: OperationId;
      reason?: string;
    }
  | {
      type: 'cancel_all_for_operation';
      operationId: OperationId;
      reason?: string;
    };

export interface InterventionState {
  byId: Map<InterventionId, Intervention>;
  /** Pending intervention ids per operation (for cancel-on-parent). */
  pendingByOperation: Map<OperationId, Set<InterventionId>>;
}

export function createInterventionState(): InterventionState {
  return {
    byId: new Map(),
    pendingByOperation: new Map(),
  };
}

export type InterventionApplyResult =
  { ok: true; intervention: Intervention; duplicate?: boolean } | { ok: false; error: string };

/**
 * Pure state machine apply. Idempotent resolve: same commandId or already
 * resolved intervention returns the existing record without mutation.
 */
export function applyInterventionTransition(
  state: InterventionState,
  transition: InterventionTransition,
  now: number = Date.now(),
): InterventionApplyResult {
  switch (transition.type) {
    case 'request': {
      const existing = state.byId.get(transition.intervention.interventionId);
      if (existing) {
        return { ok: true, intervention: existing, duplicate: true };
      }
      const intervention: Intervention = {
        ...transition.intervention,
        status: 'pending',
      };
      state.byId.set(intervention.interventionId, intervention);
      let pending = state.pendingByOperation.get(intervention.operationId);
      if (!pending) {
        pending = new Set();
        state.pendingByOperation.set(intervention.operationId, pending);
      }
      pending.add(intervention.interventionId);
      return { ok: true, intervention };
    }
    case 'resolve': {
      const current = state.byId.get(transition.interventionId);
      if (!current) {
        return { ok: false, error: `intervention_not_found:${transition.interventionId}` };
      }
      if (current.operationId !== transition.operationId) {
        return { ok: false, error: 'operation_mismatch' };
      }
      if (current.status === 'resolved') {
        // Idempotent: same or any resolve after first is a no-op success.
        return { ok: true, intervention: current, duplicate: true };
      }
      if (current.status === 'cancelled') {
        return { ok: false, error: 'intervention_cancelled' };
      }
      const next: Intervention = {
        ...current,
        status: 'resolved',
        response: transition.resolution,
        resolvedByCommandId: transition.commandId,
        resolvedAt: now,
      };
      state.byId.set(next.interventionId, next);
      state.pendingByOperation.get(next.operationId)?.delete(next.interventionId);
      return { ok: true, intervention: next };
    }
    case 'cancel': {
      const current = state.byId.get(transition.interventionId);
      if (!current) {
        return { ok: false, error: `intervention_not_found:${transition.interventionId}` };
      }
      if (current.operationId !== transition.operationId) {
        return { ok: false, error: 'operation_mismatch' };
      }
      if (current.status !== 'pending') {
        return { ok: true, intervention: current, duplicate: true };
      }
      const next: Intervention = {
        ...current,
        status: 'cancelled',
        resolvedAt: now,
        response: transition.reason ? { reason: transition.reason } : undefined,
      };
      state.byId.set(next.interventionId, next);
      state.pendingByOperation.get(next.operationId)?.delete(next.interventionId);
      return { ok: true, intervention: next };
    }
    case 'cancel_all_for_operation': {
      const pending = state.pendingByOperation.get(transition.operationId);
      if (!pending || pending.size === 0) {
        return {
          ok: true,
          intervention: {
            interventionId: '',
            operationId: transition.operationId,
            stepId: '',
            type: 'approval',
            status: 'cancelled',
            request: null,
            createdAt: now,
          },
          duplicate: true,
        };
      }
      let last: Intervention | undefined;
      for (const id of pending) {
        const result = applyInterventionTransition(
          state,
          {
            type: 'cancel',
            interventionId: id,
            operationId: transition.operationId,
            reason: transition.reason,
          },
          now,
        );
        if (result.ok) last = result.intervention;
      }
      return {
        ok: true,
        intervention: last!,
      };
    }
    default: {
      const _exhaustive: never = transition;
      void _exhaustive;
      return { ok: false, error: 'unknown_transition' };
    }
  }
}

export function operationStatusForIntervention(
  kind: InterventionKind,
): Extract<OperationStatus, 'waiting_for_approval' | 'waiting_for_input'> {
  return kind === 'approval' ? 'waiting_for_approval' : 'waiting_for_input';
}
