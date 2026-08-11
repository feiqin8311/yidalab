import type { AgentRuntimeCommand } from './commands';
import type { AgentRuntimeEvent } from './events';
import type { OperationId, Sequence } from './ids';

/**
 * Unified command + event surface for one runtime backend.
 *
 * Four implementations (later PRs / dual-path adapters):
 * - ClientRuntimeTransport
 * - ServerRuntimeTransport
 * - GatewayRuntimeTransport
 * - HeterogeneousRuntimeTransport
 *
 * Contract:
 * - execute(command) yields AgentRuntimeEvent with required sequence
 * - SubscribeOperation reattaches transport only (never mutates execution)
 * - ResumeOperation continues paused execution
 */
export interface AgentRuntimeTransport {
  /**
   * Issue a command and stream lifecycle events.
   * Implementations may complete immediately after enqueue for async backends.
   */
  execute: (command: AgentRuntimeCommand) => AsyncIterable<AgentRuntimeEvent>;

  /** Last delivered sequence for this operation in this transport session. */
  getLastSequence?: (operationId: OperationId) => Sequence;

  /**
   * Subscribe to events for an operation after a given sequence (exclusive).
   * Returns an unsubscribe function.
   */
  subscribe?: (
    operationId: OperationId,
    afterSequence: Sequence,
    handler: (event: AgentRuntimeEvent) => void,
  ) => () => void;
}

/**
 * In-memory event bus used by client dual-path and tests.
 * Not durable — Journal replaces this for reconnect authority.
 */
export class InMemoryProtocolEventBus {
  private readonly handlers = new Map<OperationId, Set<(event: AgentRuntimeEvent) => void>>();
  private readonly lastSequence = new Map<OperationId, Sequence>();
  private readonly buffers = new Map<OperationId, AgentRuntimeEvent[]>();
  private readonly maxBuffer: number;

  constructor(options?: { maxBuffer?: number }) {
    this.maxBuffer = options?.maxBuffer ?? 500;
  }

  publish(event: AgentRuntimeEvent): void {
    const { operationId, sequence } = event.meta;
    this.lastSequence.set(operationId, sequence);

    const buffer = this.buffers.get(operationId) ?? [];
    buffer.push(event);
    if (buffer.length > this.maxBuffer) buffer.splice(0, buffer.length - this.maxBuffer);
    this.buffers.set(operationId, buffer);

    const set = this.handlers.get(operationId);
    if (!set) return;
    for (const handler of set) handler(event);
  }

  subscribe(
    operationId: OperationId,
    afterSequence: Sequence,
    handler: (event: AgentRuntimeEvent) => void,
  ): () => void {
    // Replay buffered events first (session-local subscribe).
    const buffer = this.buffers.get(operationId) ?? [];
    for (const event of buffer) {
      if (event.meta.sequence > afterSequence) handler(event);
    }

    let set = this.handlers.get(operationId);
    if (!set) {
      set = new Set();
      this.handlers.set(operationId, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0) this.handlers.delete(operationId);
    };
  }

  getLastSequence(operationId: OperationId): Sequence {
    return this.lastSequence.get(operationId) ?? 0;
  }

  clear(operationId?: OperationId): void {
    if (operationId) {
      this.handlers.delete(operationId);
      this.lastSequence.delete(operationId);
      this.buffers.delete(operationId);
      return;
    }
    this.handlers.clear();
    this.lastSequence.clear();
    this.buffers.clear();
  }
}
