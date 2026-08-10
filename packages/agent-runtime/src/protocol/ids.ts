/**
 * Branded-ish id aliases for the unified Agent Runtime Protocol.
 *
 * These are plain strings at runtime. The aliases exist so call sites and
 * event scopes stay self-documenting, and so future brand narrowing is a
 * single-file change.
 */

/** Correlates one agent execution (start → terminal). Primary correlation key. */
export type OperationId = string;

/**
 * Logical multi-op run id (client lifecycle). Spans park → new operation
 * across human-in-the-loop boundaries. Optional on most protocol surfaces.
 */
export type RunId = string;

/** Stable id for one protocol event instance (idempotency with sequence). */
export type EventId = string;

/**
 * Monotonic, append-only position of an event within an operation's journal.
 *
 * REQUIRED on every target protocol event from day one — never optional.
 * PR1 adapters may mint a session-local counter; Operation Journal (later PR)
 * becomes the authoritative source.
 */
export type Sequence = number;

/** One model turn (user/system input → model response boundary). */
export type TurnId = string;

/**
 * One stable execution step inside a turn (LLM call, tool batch, compression…).
 * Replaces the numeric-only `stepIndex` for identity; adapters may still carry
 * stepIndex as a display/legacy field in payloads.
 */
export type StepId = string;

/**
 * One streamable unit inside a step (assistant text item, tool call item, …).
 * Codex-style "Item". Optional when a step has a single implicit item.
 */
export type ItemId = string;

/** Persistent human-in-the-loop request id (approval / input / selection). */
export type InterventionId = string;

/**
 * Idempotency key for a client-issued command. Required on ResolveIntervention;
 * recommended on all mutating commands so refresh / multi-tab / retry is safe.
 */
export type CommandId = string;
