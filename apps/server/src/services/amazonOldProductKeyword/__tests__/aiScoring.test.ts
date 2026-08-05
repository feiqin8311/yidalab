import { DEFAULT_THRESHOLDS } from '@lobechat/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AmazonKwAiScoring } from '../aiScoring';

const generateObject = vi.fn();

vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: class {
    generateObject = generateObject;
  },
}));

const scorer = () =>
  new AmazonKwAiScoring({} as any, 'user-1', 'ws-1', 'openai', 'gpt-test', DEFAULT_THRESHOLDS);

const profile = {
  mainAsin: 'B0CH9V3V35',
  coreCategory: '儿童剪刀',
};

describe('AmazonKwAiScoring.scoreKeywordBatch', () => {
  beforeEach(() => {
    generateObject.mockReset();
  });

  it('hard-fails when model omits keywords (no fake 50 scores)', async () => {
    generateObject.mockResolvedValue({
      items: [
        {
          keyword: 'kids scissors',
          category: '核心词',
          relevanceScore: 80,
          rationale: 'ok',
        },
        // missing: safety scissors
      ],
    });

    await expect(
      scorer().scoreKeywordBatch(profile as any, ['kids scissors', 'safety scissors']),
    ).rejects.toThrow(/AI_BATCH_INCOMPLETE/);
  });

  it('returns scores when batch is complete', async () => {
    generateObject.mockResolvedValue({
      items: [
        {
          keyword: 'kids scissors',
          category: '核心词',
          relevanceScore: 82,
          rationale: '核心品类',
        },
        {
          keyword: 'safety scissors',
          category: '功能卖点词',
          relevanceScore: 78,
          rationale: '安全属性',
        },
      ],
    });

    const scores = await scorer().scoreKeywordBatch(profile as any, [
      'kids scissors',
      'safety scissors',
    ]);
    expect(scores).toHaveLength(2);
    expect(scores.every((s) => s.relevanceScore !== 50 || s.rationale.includes('安全'))).toBe(true);
    expect(scores.find((s) => s.keyword === 'kids scissors')?.relevanceScore).toBe(82);
  });

  it('retries on incomplete then succeeds', async () => {
    generateObject
      .mockResolvedValueOnce({
        items: [
          {
            keyword: 'kids scissors',
            category: '核心词',
            relevanceScore: 80,
            rationale: 'partial',
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            keyword: 'kids scissors',
            category: '核心词',
            relevanceScore: 80,
            rationale: 'ok',
          },
          {
            keyword: 'safety scissors',
            category: '功能卖点词',
            relevanceScore: 75,
            rationale: 'ok',
          },
        ],
      });

    const scores = await scorer().scoreKeywordBatch(profile as any, [
      'kids scissors',
      'safety scissors',
    ]);
    expect(scores).toHaveLength(2);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });
});
