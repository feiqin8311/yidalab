// @vitest-environment node
import { TASK_TEMPLATE_RECOMMEND_MAX_COUNT } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { TaskTemplateService } from './index';
import { OPS_TASK_TEMPLATES } from './opsTaskTemplates';
import { createTaskTemplateRecommendationSeedKey } from './seedKey';

describe('TaskTemplateService.listDailyRecommend', () => {
  it('returns YidaLab ops templates (not Market)', async () => {
    const service = new TaskTemplateService('user-1');
    const result = await service.listDailyRecommend(['coding']);

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => OPS_TASK_TEMPLATES.some((t) => t.id === item.id))).toBe(true);
    // Company catalog — no generic lifestyle Market chips.
    expect(result.some((item) => item.identifier.startsWith('yidalab-'))).toBe(true);
  });

  it('respects count and clamps to max', async () => {
    const service = new TaskTemplateService('user-1');

    const three = await service.listDailyRecommend([], { count: 3 });
    expect(three).toHaveLength(3);

    const tooMany = await service.listDailyRecommend([], { count: 99 });
    expect(tooMany.length).toBeLessThanOrEqual(TASK_TEMPLATE_RECOMMEND_MAX_COUNT);
    expect(tooMany.length).toBeLessThanOrEqual(OPS_TASK_TEMPLATES.length);
  });

  it('excludes dismissed ids', async () => {
    const service = new TaskTemplateService('user-1');
    const first = await service.listDailyRecommend([], { count: 5 });
    const excludeIds = first.map((t) => t.id);

    const next = await service.listDailyRecommend([], { count: 5, excludeIds });
    expect(next.every((t) => !excludeIds.includes(t.id))).toBe(true);
  });

  it('changes order when refreshSeed changes', async () => {
    const service = new TaskTemplateService('user-1');
    const a = await service.listDailyRecommend([], { count: 6, refreshSeed: 'seed-a' });
    const b = await service.listDailyRecommend([], { count: 6, refreshSeed: 'seed-b' });

    expect(a.map((t) => t.id)).not.toEqual(b.map((t) => t.id));
  });
});

describe('createTaskTemplateRecommendationSeedKey', () => {
  it('is stable for the same user', () => {
    expect(createTaskTemplateRecommendationSeedKey('local-user')).toBe(
      createTaskTemplateRecommendationSeedKey('local-user'),
    );
  });
});
