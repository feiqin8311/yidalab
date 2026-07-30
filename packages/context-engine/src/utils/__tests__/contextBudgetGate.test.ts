import { describe, expect, it } from 'vitest';

import {
  estimateTokensFromText,
  evaluateContextBudgetGate,
  inputBudgetFromContextWindow,
  stripInlineFileBodiesFromText,
} from '../contextBudgetGate';

describe('evaluateContextBudgetGate', () => {
  it('allows under soft budget', () => {
    expect(evaluateContextBudgetGate({ estimatedTokens: 1000, maxTokens: 10_000 })).toEqual({
      action: 'allow',
    });
  });

  it('strips when soft exceeded', () => {
    const d = evaluateContextBudgetGate({
      estimatedTokens: 9500,
      maxTokens: 10_000,
      softTokens: 9000,
    });
    expect(d.action).toBe('strip_file_bodies');
  });

  it('rejects when hard exceeded', () => {
    const d = evaluateContextBudgetGate({ estimatedTokens: 12_000, maxTokens: 10_000 });
    expect(d.action).toBe('reject');
  });
});

describe('stripInlineFileBodiesFromText', () => {
  it('replaces file bodies', () => {
    const input = `<files><file id="f1" name="a.xlsx">HUGE BODY</file></files>`;
    const out = stripInlineFileBodiesFromText(input);
    expect(out).toContain('file id="f1"');
    expect(out).not.toContain('HUGE BODY');
    expect(out).toContain('body stripped');
  });
});

describe('estimateTokensFromText', () => {
  it('counts CJK closer to 1:1 than length/4', () => {
    const zh = '中文测试内容';
    expect(estimateTokensFromText(zh)).toBeGreaterThanOrEqual(zh.length);
    expect(estimateTokensFromText(zh)).toBeGreaterThan(Math.ceil(zh.length / 4));
  });
});

describe('inputBudgetFromContextWindow', () => {
  it('subtracts output reserve', () => {
    expect(inputBudgetFromContextWindow(200_000, 8192)).toBe(200_000 - 8192);
  });

  it('falls back when unknown', () => {
    expect(inputBudgetFromContextWindow(undefined)).toBeGreaterThan(0);
  });
});
