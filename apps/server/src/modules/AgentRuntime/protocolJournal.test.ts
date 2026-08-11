import { afterEach, describe, expect, it, vi } from 'vitest';

import { appEnv } from '@/envs/app';

import {
  createServerProtocolJournal,
  getOrCreateSequenceAllocator,
  mapWireEventToProtocolAndJournal,
  resetProtocolSequenceAllocators,
} from './protocolJournal';

vi.mock('@/envs/app', () => ({
  appEnv: {
    enableAgentRuntimeProtocolJournal: true,
  },
}));

describe('protocolJournal (server dual-path)', () => {
  afterEach(() => {
    (appEnv as { enableAgentRuntimeProtocolJournal?: boolean }).enableAgentRuntimeProtocolJournal =
      true;
  });

  it('maps wire events with monotonic per-op sequence', async () => {
    resetProtocolSequenceAllocators();
    const journal = createServerProtocolJournal();

    const a = await mapWireEventToProtocolAndJournal({
      operationId: 'op-s',
      type: 'agent_runtime_init',
      stepIndex: 0,
      data: {},
      journal,
    });
    const b = await mapWireEventToProtocolAndJournal({
      operationId: 'op-s',
      type: 'step_start',
      stepIndex: 1,
      data: {},
      journal,
    });

    expect(a[0]?.type).toBe('operation_started');
    expect(b[0]?.type).toBe('turn_started');
    expect(a[0]?.meta.sequence).toBe(1);
    expect(b[0]?.meta.sequence).toBe(2);
    expect(await journal.getLastSequence('op-s')).toBe(2);
  });

  it('skips durable journal when journal is null', async () => {
    resetProtocolSequenceAllocators();
    const mapped = await mapWireEventToProtocolAndJournal({
      operationId: 'op-null',
      type: 'agent_runtime_init',
      stepIndex: 0,
      data: {},
      journal: null,
    });
    expect(mapped[0]?.type).toBe('operation_started');
  });

  it('kill switch skips Postgres dual-write when disabled', async () => {
    resetProtocolSequenceAllocators();
    (appEnv as { enableAgentRuntimeProtocolJournal?: boolean }).enableAgentRuntimeProtocolJournal =
      false;

    // journal omitted → would default to Postgres; kill switch must short-circuit
    // before getSharedPostgresOperationJournal is used.
    const mapped = await mapWireEventToProtocolAndJournal({
      operationId: 'op-kill',
      type: 'agent_runtime_init',
      stepIndex: 0,
      data: {},
      // journal intentionally omitted
    });
    expect(mapped[0]?.type).toBe('operation_started');
  });

  it('reuses sequence allocator for the same operationId', () => {
    resetProtocolSequenceAllocators();
    const s1 = getOrCreateSequenceAllocator('op-reuse');
    s1.next();
    const s2 = getOrCreateSequenceAllocator('op-reuse');
    expect(s2.current).toBe(1);
    expect(s2.next()).toBe(2);
  });
});
