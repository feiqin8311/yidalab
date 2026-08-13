import { approxTokensFromText } from '@lobechat/types';
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

  it('keeps campaign summary and samples 2852 SIF adGroups instead of dumping all', () => {
    const payload = {
      adGroupCount: 2852,
      adGroups: Array.from({ length: 2852 }, (_, i) => ({
        adGroupCreateDate: '2025-03-03',
        adGroupId: `AG${i}`,
        adGroupType: 'SP',
        historicalKeywordCount: 11,
        variantCount: 1,
      })),
      campaignDisplayId: 'QASG',
      campaignId: 'QASG',
      campaignType: 'SP',
      structureScope: 'historical',
    };
    const r = shapeStructuredJson(payload, 800);
    expect(r.truncated).toBe(true);
    expect(r.coverage?.totalRows).toBe(2852);
    const parsed = JSON.parse(r.content) as {
      adGroupCount: number;
      adGroups: unknown[];
      campaignId: string;
      _coverage: { totalRows: number };
    };
    expect(parsed.campaignId).toBe('QASG');
    expect(parsed.adGroupCount).toBe(2852);
    expect(parsed._coverage.totalRows).toBe(2852);
    expect(parsed.adGroups.length).toBeLessThan(40);
    expect(approxTokensFromText(r.content)).toBeLessThanOrEqual(800);
  });

  it('does not crash on a single 100KB row', () => {
    const r = shapeStructuredJson(['x'.repeat(100_000)], 200);
    expect(r.truncated).toBe(true);
    expect(() => JSON.parse(r.content)).not.toThrow();
    expect(approxTokensFromText(r.content)).toBeLessThanOrEqual(200);
  });

  it('shrinks a control-char row against final stringify tokens', () => {
    // NUL expands to "\\u0000" under JSON.stringify — char-slice then wrap
    // used to stay parseable while landing ~5× over the token budget.
    const r = shapeStructuredJson(['\0'.repeat(50_000)], 200);
    expect(r.truncated).toBe(true);
    expect(() => JSON.parse(r.content)).not.toThrow();
    expect(approxTokensFromText(r.content)).toBeLessThanOrEqual(200);
  });
});

describe('shapeToolResultForModel huge row', () => {
  it('keeps valid JSON when a table cell is a 100KB line', () => {
    const r = shapeToolResultForModel({
      maxTokens: 200,
      raw: { data: ['x'.repeat(100_000)], success: true },
    });
    expect(r.truncated).toBe(true);
    expect(() => JSON.parse(r.content)).not.toThrow();
    expect(approxTokensFromText(r.content)).toBeLessThanOrEqual(200);
  });

  it('keeps a control-char table cell under the token budget', () => {
    const r = shapeToolResultForModel({
      maxTokens: 200,
      raw: { data: ['\0'.repeat(50_000)], success: true },
    });
    expect(r.truncated).toBe(true);
    expect(() => JSON.parse(r.content)).not.toThrow();
    expect(approxTokensFromText(r.content)).toBeLessThanOrEqual(200);
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
