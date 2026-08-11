import { describe, expect, it } from 'vitest';

import { createGatewayWireEventMapper } from './gatewayProtocolAdapter';

describe('gatewayProtocolAdapter', () => {
  it('maps wire lifecycle with monotonic sequence', () => {
    const mapper = createGatewayWireEventMapper('op-gw');
    const events = mapper.mapWireEvents([
      {
        type: 'agent_runtime_init',
        operationId: 'op-gw',
        stepIndex: 0,
        timestamp: 1,
        data: {},
      },
      {
        type: 'step_start',
        operationId: 'op-gw',
        stepIndex: 1,
        timestamp: 2,
        data: {},
      },
      {
        type: 'stream_chunk',
        operationId: 'op-gw',
        stepIndex: 1,
        timestamp: 3,
        data: { chunkType: 'text', content: 'hi' },
      },
      {
        type: 'agent_runtime_end',
        operationId: 'op-gw',
        stepIndex: 1,
        timestamp: 4,
        data: { reason: 'completed' },
      },
    ]);

    expect(events.map((e) => e.type)).toEqual([
      'operation_started',
      'turn_started',
      'item_delta',
      'operation_completed',
    ]);
    expect(events.map((e) => e.meta.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('drops unmapped reverse-RPC wire types', () => {
    const mapper = createGatewayWireEventMapper('op-gw');
    expect(
      mapper.mapWireEvents({
        type: 'tool_execute',
        operationId: 'op-gw',
        stepIndex: 0,
        timestamp: 1,
        data: {},
      }),
    ).toEqual([]);
  });
});
