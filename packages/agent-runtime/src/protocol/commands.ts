import type { CommandId, InterventionId, OperationId, Sequence } from './ids';

/**
 * Unified Agent Runtime Command protocol.
 *
 * Design constraints (locked):
 * 1. ResumeOperation ≠ SubscribeOperation — resume execution vs resume transport.
 * 2. ResolveIntervention carries commandId + interventionId for idempotent HIL.
 *
 * PR1 defines types only. No transport executes these yet.
 */

// ─── Shared ───

interface CommandBase {
  /**
   * Client-issued idempotency key. Required on ResolveIntervention; strongly
   * recommended on all mutating commands. Transports SHOULD ignore a replayed
   * commandId that already completed.
   */
  commandId: CommandId;
}

// ─── Start ───

export interface StartOperationCommand extends CommandBase {
  /**
   * Opaque start payload (prompt, agentId, appContext, …).
   * Shape stays product-layer specific until Start is fully normalized.
   */
  input: unknown;
  /** Optional parent for sub-agent spawn / delegate / handoff. */
  parentOperationId?: OperationId;
  type: 'start_operation';
}

// ─── Resume execution (NOT transport reconnect) ───

/**
 * Why the operation is being resumed at the execution layer.
 * Distinct from SubscribeOperation (which only reattaches an event consumer).
 */
export type ResumeReason =
  | 'after_interrupt'
  | 'after_approval'
  | 'after_tool_result'
  | 'after_input'
  | 'after_selection'
  | 'manual';

export interface ResumeOperationCommand extends CommandBase {
  operationId: OperationId;
  /**
   * Reason-specific payload (approval decision, tool result content, …).
   * Mirrors today's ResumeApprovalParam / ResumeToolResultParam structurally
   * without coupling this package to the product service layer.
   */
  payload?: unknown;
  reason: ResumeReason;
  type: 'resume_operation';
}

// ─── Subscribe / reconnect transport (NOT execution resume) ───

/**
 * Reattach a consumer to an operation's event stream after SSE/WS disconnect.
 *
 * MUST NOT start, resume, or mutate execution. Journal (later) serves events
 * with sequence > afterSequence.
 */
export interface SubscribeOperationCommand extends CommandBase {
  /**
   * Exclusive lower bound: deliver events with sequence > afterSequence.
   * Use 0 (or omit via 0) to replay from the beginning.
   */
  afterSequence: Sequence;
  operationId: OperationId;
  type: 'subscribe_operation';
}

// ─── Steer (soft input while running) ───

export interface SteerOperationCommand extends CommandBase {
  /** Queued user message / steer payload while the op is still running. */
  input: unknown;
  operationId: OperationId;
  type: 'steer_operation';
}

// ─── Interrupt ───

export interface InterruptOperationCommand extends CommandBase {
  operationId: OperationId;
  reason?: string;
  type: 'interrupt_operation';
}

// ─── Resolve intervention (idempotent HIL) ───

export type InterventionResolutionKind = 'approval' | 'input' | 'selection' | 'cancel';

/**
 * Resolve a pending human-in-the-loop request.
 *
 * Idempotency: (commandId) and (operationId, interventionId) — duplicate
 * submissions MUST NOT re-execute tools or double-apply decisions.
 */
export interface ResolveInterventionCommand extends CommandBase {
  interventionId: InterventionId;
  kind: InterventionResolutionKind;
  operationId: OperationId;
  /** Decision payload (approved/rejected, text answer, selected options, …). */
  resolution: unknown;
  type: 'resolve_intervention';
}

// ─── Union ───

/**
 * The only command protocol the unified runtime accepts.
 *
 * ResumeOperation = continue paused execution.
 * SubscribeOperation = reattach event transport after disconnect.
 * Never collapse these two into one command.
 */
export type AgentRuntimeCommand =
  | StartOperationCommand
  | ResumeOperationCommand
  | SubscribeOperationCommand
  | SteerOperationCommand
  | InterruptOperationCommand
  | ResolveInterventionCommand;

export type AgentRuntimeCommandType = AgentRuntimeCommand['type'];
