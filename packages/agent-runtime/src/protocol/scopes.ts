import type { EventId, ItemId, OperationId, Sequence, StepId, TurnId } from './ids';

/**
 * Event scope levels.
 *
 * Do NOT put turnId?/stepId? on a single wide meta — each event type picks
 * exactly one scope so TypeScript rejects illegal combinations.
 */
export type EventScopeLevel = 'operation' | 'turn' | 'item';

/** Shared envelope fields present on every event. */
export interface EventEnvelope {
  /** Stable event instance id (pair with operationId for idempotency). */
  eventId: EventId;
  /**
   * Monotonic position within the operation. Required — never optional.
   * Journal is the eventual authority; adapters may mint session-local values.
   */
  sequence: Sequence;
  /** Wall-clock ms when the event was produced (or mapped). */
  timestamp: number;
}

/**
 * Operation-scoped identity.
 * Used by: operation_started | operation_completed | operation_failed | …
 */
export interface OperationScope {
  operationId: OperationId;
  /** Sub-agent / spawn lineage when this op is a child. */
  parentOperationId?: OperationId;
}

/**
 * Turn-scoped identity.
 * Used by: turn_started | turn_completed | …
 */
export interface TurnScope extends OperationScope {
  turnId: TurnId;
}

/**
 * Item/step-scoped identity.
 * Used by: item_* | intervention_requested | checkpoint_created | …
 */
export interface ItemScope extends TurnScope {
  /** Optional when the step has a single implicit item. */
  itemId?: ItemId;
  stepId: StepId;
}

export type OperationEventMeta = EventEnvelope & OperationScope;
export type TurnEventMeta = EventEnvelope & TurnScope;
export type ItemEventMeta = EventEnvelope & ItemScope;

/** Discriminated helper: scope level → meta shape. */
export type EventMetaByScope = {
  item: ItemEventMeta;
  operation: OperationEventMeta;
  turn: TurnEventMeta;
};
