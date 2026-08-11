/**
 * Unified Agent Runtime Protocol (target language).
 *
 * Locked principles:
 * 1. ResumeOperation ≠ SubscribeOperation
 * 2. sequence is required on every event (never optional)
 * 3. Event scopes are typed (operation / turn / item) — no wide optional meta
 * 4. ResolveIntervention carries commandId + interventionId for idempotency
 *
 * Layers:
 * - commands / events / scopes / ids — wire protocol
 * - legacy-mapping — Engine/Wire → protocol (lossy matrix)
 * - transport — AgentRuntimeTransport + in-memory bus
 * - journal — append-only event log port
 * - checkpoint — recovery snapshots + tool idempotency keys
 * - intervention — durable HIL state machine
 * - subagent-graph — parent/child operation edges
 */

export * from './checkpoint';
export * from './commands';
export * from './events';
export * from './harness';
export * from './ids';
export * from './intervention';
export * from './interventionIds';
export * from './journal';
export * from './legacy-mapping';
export * from './scopes';
export * from './subagent-graph';
export * from './transport';
