// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  hashRecommendationSeed,
  OPS_TASK_TEMPLATES,
  pickOpsTaskTemplates,
  shuffleTaskTemplates,
} from './opsTaskTemplates';

describe('opsTaskTemplates', () => {
  it('catalog entries look like valid TaskTemplates', () => {
    expect(OPS_TASK_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    for (const item of OPS_TASK_TEMPLATES) {
      expect(item.identifier.startsWith('yidalab-')).toBe(true);
      expect(item.cronPattern.split(/\s+/)).toHaveLength(5);
      expect(item.connectors).toEqual([]);
      expect(item.instruction.length).toBeGreaterThan(20);
      expect(item.title.length).toBeGreaterThan(0);
    }
    const ids = OPS_TASK_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shuffle is deterministic for a seed', () => {
    const a = shuffleTaskTemplates(OPS_TASK_TEMPLATES, 42);
    const b = shuffleTaskTemplates(OPS_TASK_TEMPLATES, 42);
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
  });

  it('hashRecommendationSeed is stable', () => {
    expect(hashRecommendationSeed('user:seed')).toBe(hashRecommendationSeed('user:seed'));
    expect(hashRecommendationSeed('a')).not.toBe(hashRecommendationSeed('b'));
  });

  it('pickOpsTaskTemplates respects count and excludeIds', () => {
    const picked = pickOpsTaskTemplates({ count: 4, userId: 'u1' });
    expect(picked).toHaveLength(4);

    const excluded = pickOpsTaskTemplates({
      count: 3,
      excludeIds: [picked[0]!.id],
      userId: 'u1',
    });
    expect(excluded.every((t) => t.id !== picked[0]!.id)).toBe(true);
  });
});
