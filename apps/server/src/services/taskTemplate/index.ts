import type { TaskTemplate } from '@lobechat/const';
import { TASK_TEMPLATE_RECOMMEND_COUNT, TASK_TEMPLATE_RECOMMEND_MAX_COUNT } from '@lobechat/const';

import { pickOpsTaskTemplates } from './opsTaskTemplates';

const clampRecommendationCount = (count?: number) =>
  Math.min(Math.max(1, count ?? TASK_TEMPLATE_RECOMMEND_COUNT), TASK_TEMPLATE_RECOMMEND_MAX_COUNT);

/**
 * YidaLab: recommend company ops task templates (local catalog).
 * Upstream LobeHub pulls lifestyle chips from Market — not used here.
 */
export class TaskTemplateService {
  constructor(private userId: string) {}

  async listDailyRecommend(
    _interestKeys: string[],
    options: {
      count?: number;
      excludeIds?: number[];
      locale?: string;
      refreshSeed?: string;
    } = {},
  ): Promise<TaskTemplate[]> {
    return pickOpsTaskTemplates({
      count: clampRecommendationCount(options.count),
      excludeIds: options.excludeIds,
      refreshSeed: options.refreshSeed,
      userId: this.userId,
    });
  }
}

// Kept for tests / any seed-key callers still importing the helper.
export { createTaskTemplateRecommendationSeedKey } from './seedKey';
