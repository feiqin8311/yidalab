import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { ensureInternalJobWorkersStarted } from './handlers';
import { getRedisJobQueue } from './redisJobQueue';
import type { EnqueueOptions } from './types';

/**
 * Enqueue a job on the internal Redis queue (starts workers if needed).
 * Throws if Redis is unavailable — callers that previously required QStash
 * will surface a clear config error instead.
 */
export async function enqueueInternalJob(options: EnqueueOptions): Promise<string> {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    throw new Error(
      'REDIS_URL is required for internal job scheduling (replaces QStash). Configure Redis and retry.',
    );
  }

  ensureInternalJobWorkersStarted();
  return getRedisJobQueue(redis).enqueue(options);
}
