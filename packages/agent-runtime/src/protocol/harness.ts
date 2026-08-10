import type { CheckpointStore } from './checkpoint';
import type { AgentRuntimeCommand } from './commands';
import type { AgentRuntimeEvent } from './events';
import type { OperationId } from './ids';
import type { OperationJournal } from './journal';
import type { AgentRuntimeTransport } from './transport';

/**
 * Minimal product-free Agent harness (phase 8 types).
 *
 * Must run without React / Zustand / Next.js / TRPC / Electron.
 * Postgres is optional via injected OperationJournal.
 */
export interface AgentHarnessOptions {
  /** Optional checkpoint store for recovery. */
  checkpoints?: CheckpointStore;
  /** Optional durable journal for sequence authority + replay. */
  journal?: OperationJournal;
  /** Backend that executes commands and yields events. */
  transport: AgentRuntimeTransport;
}

export interface AgentHarness {
  interrupt: (operationId: OperationId, reason?: string) => Promise<void>;
  resume: (operationId: OperationId, payload?: unknown) => AsyncIterable<AgentRuntimeEvent>;
  run: (input: unknown) => AsyncIterable<AgentRuntimeEvent>;
  /**
   * Transport reconnect: replay journal (or transport buffer) after sequence.
   * Never mutates execution.
   */
  subscribe: (operationId: OperationId, afterSequence: number) => AsyncIterable<AgentRuntimeEvent>;
}

export function createAgentHarness(options: AgentHarnessOptions): AgentHarness {
  const { transport, journal } = options;
  let commandCounter = 0;
  const nextCommandId = () => `harness-cmd-${++commandCounter}`;

  async function* execute(command: AgentRuntimeCommand): AsyncIterable<AgentRuntimeEvent> {
    for await (const event of transport.execute(command)) {
      if (journal) {
        try {
          await journal.appendIdempotent({ event });
        } catch {
          // Harness must not fail the stream on journal errors.
        }
      }
      yield event;
    }
  }

  return {
    async *run(input: unknown) {
      yield* execute({
        commandId: nextCommandId(),
        input,
        type: 'start_operation',
      });
    },

    async *resume(operationId, payload) {
      yield* execute({
        commandId: nextCommandId(),
        operationId,
        payload,
        reason: 'manual',
        type: 'resume_operation',
      });
    },

    async interrupt(operationId, reason) {
      for await (const _ of execute({
        commandId: nextCommandId(),
        operationId,
        reason,
        type: 'interrupt_operation',
      })) {
        // drain
      }
    },

    async *subscribe(operationId, afterSequence) {
      // Prefer journal replay when available.
      if (journal) {
        const rows = await journal.read({ afterSequence, operationId });
        for (const row of rows) {
          // Reconstruct minimal envelope events for consumers that only need type/meta.
          yield {
            meta: {
              eventId: row.eventId,
              operationId: row.operationId,
              sequence: row.sequence,
              timestamp: row.createdAt.getTime(),
              ...(row.turnId ? { turnId: row.turnId } : {}),
              ...(row.stepId
                ? { stepId: row.stepId, turnId: row.turnId ?? `turn:${row.operationId}` }
                : {}),
            },
            payload: row.payload,
            type: row.type,
          } as AgentRuntimeEvent;
        }
        return;
      }

      // Fall back to transport subscribe command (session buffer).
      yield* execute({
        afterSequence,
        commandId: nextCommandId(),
        operationId,
        type: 'subscribe_operation',
      });
    },
  };
}
