import {
  type AgentRuntimeEvent,
  createSequenceAllocator,
  type InMemoryProtocolEventBus,
  type LegacyWireEventInput,
  mapWireEvent,
  type Sequence,
} from '@lobechat/agent-runtime';

/**
 * Gateway dual-path adapter: maps wire AgentStreamEvent → AgentRuntimeEvent.
 * Does not replace gatewayEventHandler UI mutations — map + optional bus only.
 *
 * Wire SSOT remains @lobechat/agent-gateway-client; we accept structural input.
 */
export interface GatewayWireEventMapper {
  readonly lastSequence: Sequence;
  mapWireEvents: (events: LegacyWireEventInput | LegacyWireEventInput[]) => AgentRuntimeEvent[];
}

export function createGatewayWireEventMapper(
  operationId: string,
  options?: {
    bus?: InMemoryProtocolEventBus;
    startAfter?: Sequence;
  },
): GatewayWireEventMapper {
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
