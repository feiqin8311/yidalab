import { describe, expect, it, vi } from 'vitest';

import {
  createClientEngineEventMapper,
  dispatchClientProtocolControlEvents,
} from './clientProtocolAdapter';

describe('clientProtocolAdapter', () => {
  it('maps engine events with monotonic sequence per operation', () => {
    const mapper = createClientEngineEventMapper('op-client');
    const events = mapper.mapStepEvents([
      { type: 'init' },
      {
        type: 'human_approve_required',
        operationId: 'op-client',
        pendingToolsCalling: [],
      },
      {
        type: 'done',
        reason: 'completed',
        finalState: {} as never,
      },
    ]);

    expect(events.map((e) => e.type)).toEqual([
      'operation_started',
      'intervention_requested',
      'operation_completed',
    ]);
    expect(events.map((e) => e.meta.sequence)).toEqual([1, 2, 3]);
    expect(mapper.lastSequence).toBe(3);
  });

  it('dispatches control-plane handlers only', async () => {
    const mapper = createClientEngineEventMapper('op-c');
    const protocolEvents = mapper.mapStepEvents([
      {
        type: 'human_approve_required',
        operationId: 'op-c',
        pendingToolsCalling: [],
      },
      { type: 'error', error: { message: 'boom' } },
    ]);

    const onInterventionRequested = vi.fn();
    const onOperationFailed = vi.fn();
    const onOperationCompleted = vi.fn();

    await dispatchClientProtocolControlEvents(protocolEvents, {
      onInterventionRequested,
      onOperationFailed,
      onOperationCompleted,
    });

    expect(onInterventionRequested).toHaveBeenCalledTimes(1);
    expect(onOperationFailed).toHaveBeenCalledTimes(1);
    expect(onOperationCompleted).not.toHaveBeenCalled();
  });
});
