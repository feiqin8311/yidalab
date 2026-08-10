import type { InterventionId, OperationId } from './ids';

/**
 * Single SSOT for intervention id generation across Client / Server / Gateway / Hetero.
 *
 * Policy: **per-tool approval** (not per-operation batch).
 * One pending tool call ⇒ one interventionId so multi-tool HIL stays addressable.
 */
export function approvalInterventionId(toolCallId: string): InterventionId {
  return `approve:${toolCallId}`;
}

export function promptInterventionId(operationId: OperationId, key?: string): InterventionId {
  return key ? `prompt:${operationId}:${key}` : `prompt:${operationId}`;
}

export function selectionInterventionId(operationId: OperationId, key?: string): InterventionId {
  return key ? `select:${operationId}:${key}` : `select:${operationId}`;
}

/**
 * Stable resolve commandId for a given intervention.
 * Callers MUST reuse this across retries of the same logical user action when
 * no inbound commandId is available — never Date.now().
 */
export function stableResolveCommandId(
  operationId: OperationId,
  interventionId: InterventionId,
  decision: string,
): string {
  return `resolve:${operationId}:${interventionId}:${decision}`;
}
