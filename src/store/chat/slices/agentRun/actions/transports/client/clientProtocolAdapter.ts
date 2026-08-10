import {
  type AgentEvent,
  type AgentRuntimeEvent,
  createSequenceAllocator,
  type InMemoryProtocolEventBus,
  mapEngineEvent,
  type Sequence,
} from '@lobechat/agent-runtime';

/**
 * Client dual-path adapter: maps engine AgentEvent[] from runtime.step()
 * into sequenced AgentRuntimeEvent without changing UI behavior.
 *
 * Streaming tokens still flow through StreamingHandler / createAgentExecutors.
 * This adapter is the control-plane protocol egress for the client path.
 */
export interface ClientEngineEventMapper {
  readonly lastSequence: Sequence;
  /** Map one step's engine events; sequences are monotonic per operation session. */
  mapStepEvents: (events: AgentEvent[]) => AgentRuntimeEvent[];
}

export function createClientEngineEventMapper(
  operationId: string,
  options?: {
    bus?: InMemoryProtocolEventBus;
    startAfter?: Sequence;
    turnId?: string;
    stepId?: string;
  },
): ClientEngineEventMapper {
  const sequences = createSequenceAllocator(options?.startAfter ?? 0);

  return {
    get lastSequence() {
      return sequences.current;
    },
    mapStepEvents(events: AgentEvent[]): AgentRuntimeEvent[] {
      const mapped = events.flatMap((event) =>
        mapEngineEvent(event, {
          operationId,
          sequences,
          stepId: options?.stepId,
          turnId: options?.turnId,
        }),
      );
      if (options?.bus) {
        for (const event of mapped) options.bus.publish(event);
      }
      return mapped;
    },
  };
}

/**
 * Control-plane handlers already present in streamingExecutor (done / HIL / error).
 * Prefer matching protocol types when dual-consuming; keep side effects identical.
 */
export type ClientProtocolControlHandler = {
  onOperationCompleted?: (
    event: Extract<AgentRuntimeEvent, { type: 'operation_completed' }>,
  ) => void;
  onOperationFailed?: (
    event: Extract<AgentRuntimeEvent, { type: 'operation_failed' }>,
  ) => void | Promise<void>;
  onInterventionRequested?: (
    event: Extract<AgentRuntimeEvent, { type: 'intervention_requested' }>,
  ) => void | Promise<void>;
};

export async function dispatchClientProtocolControlEvents(
  events: AgentRuntimeEvent[],
  handlers: ClientProtocolControlHandler,
): Promise<void> {
  for (const event of events) {
    switch (event.type) {
      case 'operation_completed': {
        handlers.onOperationCompleted?.(event);
        break;
      }
      case 'operation_failed': {
        await handlers.onOperationFailed?.(event);
        break;
      }
      case 'intervention_requested': {
        await handlers.onInterventionRequested?.(event);
        break;
      }
      default: {
        break;
      }
    }
  }
}
