import { createHash } from 'node:crypto';

import { appEnv } from '@/envs/app';

const getInstanceSeedScope = () =>
  process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_PRODUCTION_URL || appEnv.APP_URL;

/** Legacy Market seed key — retained for tests / compatibility. */
export const createTaskTemplateRecommendationSeedKey = (
  userId: string,
  instanceSeedScope = getInstanceSeedScope(),
) =>
  createHash('sha256')
    .update(`task-template-recommendation:v1:${instanceSeedScope}:${userId}`)
    .digest('base64url');
