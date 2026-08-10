import { describe, expect, it } from 'vitest';

import type { AgentRuntimeCommand } from './commands';
import type { AgentRuntimeEvent } from './events';
import { createAgentHarness } from './harness';
import { InMemoryOperationJournal } from './journal';
import { createSequenceAllocator, mapEngineEvent } from './legacy-mapping';
import type { AgentRuntimeTransport } from './transport';

function createFakeTransport(events: AgentRuntimeEvent[]): AgentRuntimeTransport {
  return {
    async *execute(_command: AgentRuntimeCommand) {
      for (const event of events) yield event;
    },
  };
}

describe('AgentHarness', () => {
  it('runs start_operation and journals events', async () => {
    const seq = createSequenceAllocator(0);
    const seed = mapEngineEvent(
      { type: 'init' },
      { operationId: 'op-h', sequences: seq, now: () => 1 },
    );
    const journal = new InMemoryOperationJournal();
    const harness = createAgentHarness({
      journal,
      transport: createFakeTransport(seed),
    });

    const out: AgentRuntimeEvent[] = [];
    for await (const e of harness.run({ prompt: 'hi' })) out.push(e);

    expect(out.map((e) => e.type)).toEqual(['operation_started']);
    expect(await journal.getLastSequence('op-h')).toBe(1);
  });

  it('subscribe replays journal after sequence', async () => {
    const journal = new InMemoryOperationJournal();
    const seq = createSequenceAllocator(0);
    const events = [
      ...mapEngineEvent({ type: 'init' }, { operationId: 'op-s', sequences: seq, now: () => 1 }),
      ...mapEngineEvent(
        { type: 'error', error: { message: 'x' } },
        { operationId: 'op-s', sequences: seq, now: () => 2 },
      ),
    ];
    for (const e of events) await journal.append({ event: e });

    const harness = createAgentHarness({
      journal,
      transport: createFakeTransport([]),
    });

    const replayed: number[] = [];
    for await (const e of harness.subscribe('op-s', 1)) {
      replayed.push(e.meta.sequence);
    }
    expect(replayed).toEqual([2]);
  });
});
