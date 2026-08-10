import type { InterventionId } from './ids';
import type { ItemEventMeta, OperationEventMeta, TurnEventMeta } from './scopes';

/**
 * Unified Agent Runtime Event protocol.
 *
 * Every event is a discriminated union member with a scope-correct meta:
 * - Operation events → OperationEventMeta (operationId required)
 * - Turn events      → TurnEventMeta      (operationId + turnId)
 * - Item events      → ItemEventMeta      (operationId + turnId + stepId)
 *
 * `sequence` is always required on meta (see scopes.EventEnvelope).
 */

// ─── Operation scope ───

export interface OperationStartedEvent {
  meta: OperationEventMeta;
  payload?: {
    parentOperationId?: string;
    trigger?: string;
  };
  type: 'operation_started';
}

export interface OperationCompletedEvent {
  meta: OperationEventMeta;
  payload: {
    reason: string;
    reasonDetail?: string;
  };
  type: 'operation_completed';
}

export interface OperationFailedEvent {
  meta: OperationEventMeta;
  payload: {
    error: unknown;
  };
  type: 'operation_failed';
}

/**
 * Recoverable interrupt (user cancel / soft stop). Distinct from operation_failed.
 * Consumers MUST NOT treat this as a hard error terminal for resume eligibility.
 */
export interface OperationInterruptedEvent {
  meta: OperationEventMeta;
  payload: {
    canResume: boolean;
    reason: string;
    interruptedAt?: string;
    metadata?: Record<string, unknown>;
  };
  type: 'operation_interrupted';
}

// ─── Turn scope ───

export interface TurnStartedEvent {
  meta: TurnEventMeta;
  payload?: {
    /** Numeric legacy step index when mapped from wire. */
    stepIndex?: number;
  };
  type: 'turn_started';
}

export interface TurnCompletedEvent {
  meta: TurnEventMeta;
  payload?: {
    phase?: string;
    reason?: string;
    reasonDetail?: string;
    stepIndex?: number;
  };
  type: 'turn_completed';
}

// ─── Item scope ───

export type ItemKind =
  'assistant_message' | 'reasoning' | 'tool_call' | 'tool_result' | 'compression' | 'unknown';

export interface ItemStartedEvent {
  meta: ItemEventMeta;
  payload: {
    kind: ItemKind;
    /** Opaque item-specific start data (toolCalling, assistantMessage seed, …). */
    data?: unknown;
  };
  type: 'item_started';
}

export interface ItemDeltaEvent {
  meta: ItemEventMeta;
  payload: {
    kind: ItemKind;
    /** Incremental chunk (text / reasoning / tool_calls partial, …). */
    delta: unknown;
  };
  type: 'item_delta';
}

export interface ItemCompletedEvent {
  meta: ItemEventMeta;
  payload: {
    kind: ItemKind;
    /** Final item payload (tool result, full message, …). */
    data?: unknown;
    isSuccess?: boolean;
  };
  type: 'item_completed';
}

export type InterventionRequestKind = 'approval' | 'input' | 'selection';

export interface InterventionRequestedEvent {
  meta: ItemEventMeta;
  payload: {
    interventionId: InterventionId;
    kind: InterventionRequestKind;
    /** Opaque request body (pending tool calls, prompt, options, …). */
    request: unknown;
  };
  type: 'intervention_requested';
}

export interface CheckpointCreatedEvent {
  meta: ItemEventMeta;
  payload: {
    /** Opaque checkpoint ref / id. Full AgentCheckpoint lands in a later PR. */
    checkpointId: string;
    /** Why this checkpoint was taken. */
    reason?: string;
  };
  type: 'checkpoint_created';
}

// ─── Union ───

export type AgentRuntimeEvent =
  | OperationStartedEvent
  | OperationCompletedEvent
  | OperationFailedEvent
  | OperationInterruptedEvent
  | TurnStartedEvent
  | TurnCompletedEvent
  | ItemStartedEvent
  | ItemDeltaEvent
  | ItemCompletedEvent
  | InterventionRequestedEvent
  | CheckpointCreatedEvent;

export type AgentRuntimeEventType = AgentRuntimeEvent['type'];

/** Events whose meta is OperationEventMeta. */
export type OperationScopedEvent =
  | OperationStartedEvent
  | OperationCompletedEvent
  | OperationFailedEvent
  | OperationInterruptedEvent;

/**
 * Events that belong in durable Journal (control plane).
 * High-frequency deltas stay on Redis/hot path only — never bulk-insert to PG.
 */
export const JOURNALABLE_EVENT_TYPES = [
  'operation_started',
  'operation_completed',
  'operation_failed',
  'operation_interrupted',
  'turn_started',
  'turn_completed',
  'item_started',
  'item_completed',
  'intervention_requested',
  'checkpoint_created',
] as const satisfies readonly AgentRuntimeEventType[];

export type JournalableEventType = (typeof JOURNALABLE_EVENT_TYPES)[number];

export function isJournalableEventType(type: string): type is JournalableEventType {
  return (JOURNALABLE_EVENT_TYPES as readonly string[]).includes(type);
}

/** Events whose meta is TurnEventMeta. */
export type TurnScopedEvent = TurnStartedEvent | TurnCompletedEvent;

/** Events whose meta is ItemEventMeta. */
export type ItemScopedEvent =
  | ItemStartedEvent
  | ItemDeltaEvent
  | ItemCompletedEvent
  | InterventionRequestedEvent
  | CheckpointCreatedEvent;

/** Exhaustive list of event type discriminators (for tests / routers). */
export const AGENT_RUNTIME_EVENT_TYPES = [
  'operation_started',
  'operation_completed',
  'operation_failed',
  'operation_interrupted',
  'turn_started',
  'turn_completed',
  'item_started',
  'item_delta',
  'item_completed',
  'intervention_requested',
  'checkpoint_created',
] as const satisfies readonly AgentRuntimeEventType[];

/** Exhaustive list of command type discriminators. */
export const AGENT_RUNTIME_COMMAND_TYPES = [
  'start_operation',
  'resume_operation',
  'subscribe_operation',
  'steer_operation',
  'interrupt_operation',
  'resolve_intervention',
] as const;

/** Narrow helper: ensure sequence is a finite non-negative integer. */
export function isValidSequence(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isInteger(value)
  );
}

/** Type guard: event carries required envelope fields including sequence. */
export function hasEventEnvelope(
  event: AgentRuntimeEvent,
): event is AgentRuntimeEvent & { meta: { eventId: string; sequence: number; timestamp: number } } {
  const { meta } = event;
  return (
    typeof meta.eventId === 'string' &&
    meta.eventId.length > 0 &&
    isValidSequence(meta.sequence) &&
    typeof meta.timestamp === 'number'
  );
}
