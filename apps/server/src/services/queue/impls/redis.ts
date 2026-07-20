import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { ensureInternalJobWorkersStarted } from '@/server/services/internalJob/handlers';
import { getRedisJobQueue } from '@/server/services/internalJob/redisJobQueue';
import { JOB_NAMES } from '@/server/services/internalJob/types';

import { type HealthCheckResult, type QueueMessage, type QueueStats } from '../types';
import { type QueueServiceImpl } from './type';

const log = debug('lobe-server:service:queue:redis');

/**
 * Redis-backed queue service for AGENT_RUNTIME_MODE=queue.
 * Replaces QStash: enqueues agent step jobs; workers run executeAgentRuntimeStepJob.
 */
export class RedisQueueServiceImpl implements QueueServiceImpl {
  private ensureWorkers(): void {
    ensureInternalJobWorkersStarted();
  }

  private getQueue() {
    const redis = getAgentRuntimeRedisClient();
    if (!redis) {
      throw new Error('REDIS_URL is required when AGENT_RUNTIME_MODE=queue (Redis job queue)');
    }
    return getRedisJobQueue(redis);
  }

  async scheduleMessage(message: QueueMessage): Promise<string> {
    this.ensureWorkers();
    const { operationId, stepIndex, context, payload, delay = 50, retries = 5 } = message;

    const jobId = await this.getQueue().enqueue({
      delayMs: delay,
      maxAttempts: retries,
      name: JOB_NAMES.agentRuntimeStep,
      payload: {
        context,
        operationId,
        payload,
        stepIndex,
        // Flatten resume/intervention fields at top level (local path style)
        ...payload,
      },
    });

    log(
      '[%s] Scheduled step %d via Redis job %s (delay %dms)',
      operationId,
      stepIndex,
      jobId,
      delay,
    );
    return jobId;
  }

  async scheduleBatchMessages(messages: QueueMessage[]): Promise<string[]> {
    return Promise.all(messages.map((m) => this.scheduleMessage(m)));
  }

  async cancelScheduledTask(taskId: string): Promise<void> {
    if (!taskId) return;
    try {
      await this.getQueue().cancel(taskId);
    } catch (error) {
      log('cancelScheduledTask failed for %s: %O', taskId, error);
    }
  }

  async getQueueStats(): Promise<QueueStats> {
    return {
      completedCount: 0,
      failedCount: 0,
      pendingCount: 0,
      processingCount: 0,
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const redis = getAgentRuntimeRedisClient();
      if (!redis) {
        return { healthy: false, message: 'Redis not configured for job queue' };
      }
      await redis.ping();
      return { healthy: true, message: 'Redis job queue healthy' };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Redis job queue unhealthy',
      };
    }
  }
}
