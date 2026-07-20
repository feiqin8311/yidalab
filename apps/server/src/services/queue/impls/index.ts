import { appEnv } from '@/envs/app';

import { LocalQueueServiceImpl } from './local';
import { RedisQueueServiceImpl } from './redis';
import { type QueueServiceImpl } from './type';

/**
 * Check if queue-based agent runtime is enabled
 * Set via AGENT_RUNTIME_MODE=queue environment variable
 */
export const isQueueAgentRuntimeEnabled = (): boolean => {
  return appEnv.enableQueueAgentRuntime === true;
};

/**
 * Create queue service module
 *
 * When enableQueueAgentRuntime=true (AGENT_RUNTIME_MODE=queue):
 *   - RedisQueueServiceImpl (production, requires REDIS_URL — no QStash)
 *
 * When enableQueueAgentRuntime=false (default):
 *   - LocalQueueServiceImpl (local development, uses setTimeout for async execution)
 */
export const createQueueServiceModule = (): QueueServiceImpl => {
  if (isQueueAgentRuntimeEnabled()) {
    return new RedisQueueServiceImpl();
  }

  // Local mode (default): use LocalQueueServiceImpl with callback mechanism
  return new LocalQueueServiceImpl();
};

export { LocalQueueServiceImpl } from './local';
export { RedisQueueServiceImpl } from './redis';
// Keep export for tests that still import the old QStash impl directly
export { QStashQueueServiceImpl } from './qstash';
export type { QueueServiceImpl } from './type';
