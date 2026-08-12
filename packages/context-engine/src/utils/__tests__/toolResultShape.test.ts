import { describe, expect, it } from 'vitest';

import {
  allocateRoundToolBudgets,
  buildToolResultReceipt,
  shapeStructuredJson,
  shapeToolResultForModel,
  unwrapMcpEnvelope,
} from '../toolResultShape';

describe('unwrapMcpEnvelope', () => {
  it('unwraps { content, state, success } envelope', () => {
    const inner = { rows: [1, 2, 3] };
    const r = unwrapMcpEnvelope({ content: inner, state: { content: [] }, success: true });
    expect(r.unwrapped).toBe(true);
    expect(r.content).toEqual(inner);
  });

  it('does not unwrap ordinary business JSON with content field', () => {
    const biz = { content: 'hello', title: 'x' };
    const r = unwrapMcpEnvelope(biz);
    expect(r.unwrapped).toBe(false);
    expect(r.content).toEqual(biz);
  });

  it('does not unwrap business objects that also have success', () => {
    const biz = { content: 'hello', title: 'x', pagination: { page: 1 }, success: true };
    const r = unwrapMcpEnvelope(biz);
    expect(r.unwrapped).toBe(false);
    expect(r.content).toEqual(biz);
  });

  it('does not unwrap domain objects with state.content mirror + extra keys', () => {
    const biz = {
      content: 'hello',
      state: { content: [{ text: 'hello' }] },
      success: true,
      title: 'business',
    };
    const r = unwrapMcpEnvelope(biz);
    expect(r.unwrapped).toBe(false);
    expect(r.content).toEqual(biz);
  });

  it('unwraps stringified envelope', () => {
    const r = unwrapMcpEnvelope(JSON.stringify({ content: 'payload', state: {}, success: true }));
    expect(r.unwrapped).toBe(true);
    expect(r.content).toBe('payload');
  });
});

describe('shapeStructuredJson', () => {
  it('keeps small JSON intact', () => {
    const r = shapeStructuredJson({ a: 1 }, 1000);
    expect(r.truncated).toBe(false);
    expect(JSON.parse(r.content)).toEqual({ a: 1 });
  });

  it('truncates large arrays with coverage', () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: i, v: 'x'.repeat(20) }));
    const r = shapeStructuredJson(rows, 200);
    expect(r.truncated).toBe(true);
    expect(r.coverage?.totalRows).toBe(500);
    expect(() => JSON.parse(r.content)).not.toThrow();
  });
});

describe('shapeToolResultForModel', () => {
  it('unwraps MCP and shapes under token budget', () => {
    const big = { data: Array.from({ length: 200 }, (_, i) => ({ i, s: 'word'.repeat(10) })) };
    const r = shapeToolResultForModel({
      maxTokens: 300,
      raw: { content: big, state: { content: [] }, success: true },
    });
    expect(r.unwrapped).toBe(true);
    expect(r.truncated).toBe(true);
    expect(() => JSON.parse(r.content)).not.toThrow();
  });

  it('respects maxChars hard cap', () => {
    const r = shapeToolResultForModel({
      maxChars: 100,
      maxTokens: 50_000,
      raw: 'x'.repeat(5000),
    });
    expect(r.content.length).toBeLessThanOrEqual(120);
    expect(r.truncated).toBe(true);
  });

  it('state does not appear in model content after unwrap', () => {
    const r = shapeToolResultForModel({
      maxTokens: 1000,
      raw: {
        content: 'only-this',
        state: { content: [{ text: 'only-this' }], secret: 'nope' },
        success: true,
      },
    });
    expect(r.content).toBe('only-this');
    expect(r.content).not.toContain('secret');
  });
});

describe('allocateRoundToolBudgets', () => {
  it('splits round budget with floor', () => {
    const budgets = allocateRoundToolBudgets(4, 20_000, 8_000);
    expect(budgets).toHaveLength(4);
    expect(budgets.every((b) => b >= 512)).toBe(true);
    expect(budgets.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(20_000);
  });
});

describe('buildToolResultReceipt', () => {
  it('includes tool meta', () => {
    const s = buildToolResultReceipt({
      apiName: 'search',
      identifier: 'sif-mcp',
      originalTokens: 12000,
      success: true,
      toolCallId: 'call_1',
    });
    expect(s).toContain('sif-mcp');
    expect(s).toContain('search');
    expect(s).toContain('call_1');
  });
});
