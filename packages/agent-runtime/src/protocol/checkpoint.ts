import type { InterventionId, OperationId, Sequence, StepId } from './ids';

/**
 * Stable recovery snapshot for one operation step.
 * Full recovery wiring lands with Journal + tool idempotency keys.
 */
export interface PendingToolCall {
  arguments: string;
  /** Idempotency key: operationId + stepId + toolCallId */
  idempotencyKey: string;
  name: string;
  /** When set, tool already finished — do not re-execute on resume. */
  result?: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  toolCallId: string;
}

export interface PendingInterventionSnapshot {
  interventionId: InterventionId;
  kind: 'approval' | 'input' | 'selection';
  request: unknown;
  status: 'pending' | 'resolved' | 'cancelled';
}

export interface ContextManifestFragmentRef {
  contentHash: string;
  id: string;
  kind: string;
  tokenCount: number;
}

export interface ContextManifest {
  fragments: ContextManifestFragmentRef[];
  totalTokens: number;
}

export interface AgentCheckpoint {
  /** Opaque serialized AgentState (product-layer shape). */
  agentState: unknown;
  contextManifest?: ContextManifest;
  createdAt: number;
  operationId: OperationId;
  pendingCalls: PendingToolCall[];
  pendingIntervention?: PendingInterventionSnapshot;
  reason?: string;
  sequence: Sequence;
  stepId: StepId;
}

export function toolIdempotencyKey(
  operationId: OperationId,
  stepId: StepId,
  toolCallId: string,
): string {
  return `${operationId}:${stepId}:${toolCallId}`;
}

/**
 * Checkpoint reasons aligned with the architecture plan.
 */
export type CheckpointReason =
  | 'before_model'
  | 'after_model'
  | 'after_tool'
  | 'after_compression'
  | 'intervention_requested'
  | 'subagent_spawned'
  | 'turn_completed'
  | 'manual';

export interface CheckpointStore {
  list: (operationId: OperationId) => Promise<AgentCheckpoint[]>;
  /**
   * Latest checkpoint for an operation, or the one at/before sequence.
   */
  load: (
    operationId: OperationId,
    options?: { atOrBeforeSequence?: Sequence },
  ) => Promise<AgentCheckpoint | null>;
  save: (checkpoint: AgentCheckpoint) => Promise<void>;
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly byOp = new Map<OperationId, AgentCheckpoint[]>();

  async save(checkpoint: AgentCheckpoint): Promise<void> {
    const rows = this.byOp.get(checkpoint.operationId) ?? [];
    rows.push(checkpoint);
    rows.sort((a, b) => a.sequence - b.sequence);
    this.byOp.set(checkpoint.operationId, rows);
  }

  async load(
    operationId: OperationId,
    options?: { atOrBeforeSequence?: Sequence },
  ): Promise<AgentCheckpoint | null> {
    const rows = this.byOp.get(operationId) ?? [];
    if (rows.length === 0) return null;
    if (options?.atOrBeforeSequence === undefined) return rows.at(-1)!;
    const bound = options.atOrBeforeSequence;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]!.sequence <= bound) return rows[i]!;
    }
    return null;
  }

  async list(operationId: OperationId): Promise<AgentCheckpoint[]> {
    return [...(this.byOp.get(operationId) ?? [])];
  }
}
