import { describe, expect, it } from 'vitest';

import { collectProtectedToolIds, ToolResultPruneProcessor } from '../ToolResultPrune';

describe('collectProtectedToolIds', () => {
  it('protects only the latest assistant group, not earlier same-turn steps', () => {
    // Hot path: multi-step agent within one user turn
    const messages = [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant', tools: [{ id: 't1' }] },
      { id: 'tm1', role: 'tool', tool_call_id: 't1', content: 'step1' },
      { id: 'a2', role: 'assistant', tools: [{ id: 't2' }] },
      { id: 'tm2', role: 'tool', tool_call_id: 't2', content: 'step2' },
      { id: 'a3', role: 'assistant', tools: [{ id: 't3' }] },
      { id: 'tm3', role: 'tool', tool_call_id: 't3', content: 'step3' },
    ];
    const ids = collectProtectedToolIds(messages);
    expect(ids.has('t3') || ids.has('tm3')).toBe(true);
    expect(ids.has('t1') || ids.has('tm1')).toBe(false);
    expect(ids.has('t2') || ids.has('tm2')).toBe(false);
  });

  it('protects trailing tool chain across user turns only for latest', () => {
    const messages = [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant', tools: [{ id: 't1' }] },
      { id: 'tm1', role: 'tool', tool_call_id: 't1', content: 'old' },
      { id: 'u2', role: 'user' },
      { id: 'a2', role: 'assistant', tools: [{ id: 't2' }] },
      { id: 'tm2', role: 'tool', tool_call_id: 't2', content: 'new' },
    ];
    const ids = collectProtectedToolIds(messages);
    expect(ids.has('t2') || ids.has('tm2')).toBe(true);
    expect(ids.has('t1') || ids.has('tm1')).toBe(false);
  });
});

describe('ToolResultPruneProcessor', () => {
  it('prunes old tool bodies over budget, keeps current chain', async () => {
    const big = 'x'.repeat(20_000); // ~5k tokens
    const messages = [
      { id: 'u1', role: 'user', content: 'hi' },
      {
        id: 'a1',
        role: 'assistant',
        tools: [{ id: 't1' }],
        content: '',
      },
      {
        id: 'tm1',
        role: 'tool',
        tool_call_id: 't1',
        plugin: { identifier: 'sif', apiName: 'q' },
        content: big,
      },
      { id: 'u2', role: 'user', content: 'next' },
      {
        id: 'a2',
        role: 'assistant',
        tools: [{ id: 't2' }],
        content: '',
      },
      {
        id: 'tm2',
        role: 'tool',
        tool_call_id: 't2',
        plugin: { identifier: 'sif', apiName: 'q2' },
        content: big,
      },
    ];

    const processor = new ToolResultPruneProcessor({
      enabled: true,
      maxHistoricalToolTokens: 1000,
    });
    const result = await processor.process({
      initialContext: {},
      messages,
      metadata: {},
      stepContext: {},
    } as any);

    const old = result.messages.find((m: any) => m.id === 'tm1')!;
    const cur = result.messages.find((m: any) => m.id === 'tm2')!;
    expect(old.content).toContain('tool_receipt');
    expect(cur.content).toBe(big);
    expect(old.tool_call_id).toBe('t1');
  });

  it('no-ops under budget', async () => {
    const processor = new ToolResultPruneProcessor({ maxHistoricalToolTokens: 100_000 });
    const messages = [
      { id: 'u1', role: 'user', content: 'hi' },
      { id: 'a1', role: 'assistant', tools: [{ id: 't1' }] },
      { id: 'tm1', role: 'tool', tool_call_id: 't1', content: 'small' },
    ];
    const result = await processor.process({
      initialContext: {},
      messages,
      metadata: {},
      stepContext: {},
    } as any);
    expect(result.messages[2].content).toBe('small');
    expect(result.metadata.toolResultPruned).toBe(0);
  });

  it('shapes the current tool chain under per-result and round budgets', async () => {
    const big = 'x'.repeat(40_000);
    const messages = [
      { id: 'u1', role: 'user', content: 'hi' },
      { id: 'a1', role: 'assistant', tools: [{ id: 't1' }, { id: 't2' }], content: '' },
      {
        id: 'tm1',
        role: 'tool',
        tool_call_id: 't1',
        plugin: { identifier: 'sif', apiName: 'q1' },
        content: big,
      },
      {
        id: 'tm2',
        role: 'tool',
        tool_call_id: 't2',
        plugin: { identifier: 'sif', apiName: 'q2' },
        content: big,
      },
    ];

    const processor = new ToolResultPruneProcessor({
      enabled: true,
      maxHistoricalToolTokens: 100_000,
      maxToolResultTokens: 2_000,
      maxToolRoundTokens: 3_000,
    });
    const result = await processor.process({
      initialContext: {},
      messages,
      metadata: {},
      stepContext: {},
    } as any);

    const tm1 = result.messages.find((m: any) => m.id === 'tm1')!;
    const tm2 = result.messages.find((m: any) => m.id === 'tm2')!;
    expect(tm1.content.length).toBeLessThan(big.length);
    expect(tm2.content.length).toBeLessThan(big.length);
    expect(tm1.tool_call_id).toBe('t1');
    expect(tm2.tool_call_id).toBe('t2');
  });

  it('prunes earlier steps in same user turn multi-step trajectory', async () => {
    const big = 'x'.repeat(20_000);
    const messages = [
      { id: 'u1', role: 'user', content: 'hi' },
      { id: 'a1', role: 'assistant', tools: [{ id: 't1' }], content: '' },
      {
        id: 'tm1',
        role: 'tool',
        tool_call_id: 't1',
        plugin: { identifier: 'sif', apiName: 'q' },
        content: big,
      },
      { id: 'a2', role: 'assistant', tools: [{ id: 't2' }], content: '' },
      {
        id: 'tm2',
        role: 'tool',
        tool_call_id: 't2',
        plugin: { identifier: 'sif', apiName: 'q2' },
        content: big,
      },
    ];

    const processor = new ToolResultPruneProcessor({
      enabled: true,
      maxHistoricalToolTokens: 1000,
    });
    const result = await processor.process({
      initialContext: {},
      messages,
      metadata: {},
      stepContext: {},
    } as any);

    const step1 = result.messages.find((m: any) => m.id === 'tm1')!;
    const step2 = result.messages.find((m: any) => m.id === 'tm2')!;
    expect(step1.content).toContain('tool_receipt');
    expect(step2.content).toBe(big);
  });
});
