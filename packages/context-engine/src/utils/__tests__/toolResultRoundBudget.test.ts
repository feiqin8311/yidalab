import { approxTokensFromText } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { applyRoundToolResultBudgets } from '../toolResultShape';

describe('applyRoundToolResultBudgets', () => {
  it('no-ops under budget', () => {
    const out = applyRoundToolResultBudgets(
      [
        { content: 'small', success: true },
        { content: 'also small', success: true },
      ],
      20_000,
    );
    expect(out.every((r) => !r.reshaped)).toBe(true);
  });

  it('shrinks large items when over budget', () => {
    const big = 'word '.repeat(10_000);
    const out = applyRoundToolResultBudgets(
      [
        { content: big, identifier: 'a', apiName: 'q', success: true, toolCallId: '1' },
        { content: big, identifier: 'b', apiName: 'q', success: true, toolCallId: '2' },
        { content: big, identifier: 'c', apiName: 'q', success: true, toolCallId: '3' },
      ],
      2_000,
    );
    expect(out.some((r) => r.reshaped)).toBe(true);
    const totalLen = out.reduce((s, r) => s + r.content.length, 0);
    expect(totalLen).toBeLessThan(big.length * 3);
  });

  it('caps twelve 25KB tool results to the bot 16k-token round budget', () => {
    const payload = JSON.stringify({
      adGroups: Array.from({ length: 80 }, (_, i) => ({
        adGroupId: `AG${i}`,
        notes: 'n'.repeat(320),
      })),
    });
    expect(payload.length).toBeGreaterThan(25_000);

    const out = applyRoundToolResultBudgets(
      Array.from({ length: 12 }, (_, i) => ({
        apiName: 'ads_get_campaign_structure',
        content: payload,
        identifier: 'sif',
        success: true,
        toolCallId: `t${i}`,
      })),
      16_000,
    );

    const totalTokens = out.reduce((sum, item) => sum + approxTokensFromText(item.content), 0);
    expect(totalTokens).toBeLessThanOrEqual(16_000);
    expect(out.every((item) => item.content.length > 0)).toBe(true);
  });
});
