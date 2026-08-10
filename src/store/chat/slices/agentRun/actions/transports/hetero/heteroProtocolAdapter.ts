import {
  type AgentRuntimeEvent,
  createSequenceAllocator,
  type InMemoryProtocolEventBus,
  type LegacyWireEventInput,
  mapWireEvent,
  type Sequence,
} from '@lobechat/agent-runtime';

/**
 * Heterogeneous agents emit wire-shaped events (AgentStreamEvent-compatible).
 * Reuse the same mapWireEvent path as gateway — one protocol dialect at the edge.
 */
export interface HeteroWireEventMapper {
  readonly lastSequence: Sequence;
  mapWireEvents: (events: LegacyWireEventInput | LegacyWireEventInput[]) => AgentRuntimeEvent[];
}

export function createHeteroWireEventMapper(
  operationId: string,
  options?: {
    bus?: InMemoryProtocolEventBus;
    startAfter?: Sequence;
  },
): HeteroWireEventMapper {
  const sequences = createSequenceAllocator(options?.startAfter ?? 0);

  return {
    get lastSequence() {
      return sequences.current;
    },
    mapWireEvents(input): AgentRuntimeEvent[] {
      const list = Array.isArray(input) ? input : [input];
      const mapped = list.flatMap((event) =>
        mapWireEvent(event, {
          operationId: event.operationId || operationId,
          sequences,
        }),
      );
      if (options?.bus) {
        for (const event of mapped) options.bus.publish(event);
      }
      return mapped;
    },
  };
}
