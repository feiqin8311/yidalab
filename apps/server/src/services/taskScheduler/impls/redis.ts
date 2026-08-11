import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { ensureInternalJobWorkersStarted } from '@/server/services/internalJob/handlers';
import { getRedisJobQueue } from '@/server/services/internalJob/redisJobQueue';
import { JOB_NAMES } from '@/server/services/internalJob/types';

import type { ScheduleNextTopicParams, TaskSchedulerImpl } from './type';

const log = debug('task-scheduler:redis');

/**
 * Redis job-backed task scheduler (replaces QStash delayed publish to heartbeat-tick).
 */
export class RedisTaskScheduler implements TaskSchedulerImpl {
  private ensureWorkers(): void {
    ensureInternalJobWorkersStarted();
  }

  private getQueue() {
    const redis = getAgentRuntimeRedisClient();
    if (!redis) {
      throw new Error('REDIS_URL is required when AGENT_RUNTIME_MODE=queue (Redis task scheduler)');
    }
    return getRedisJobQueue(redis);
  }

  async scheduleNextTopic(params: ScheduleNextTopicParams): Promise<string> {
    const { taskId, userId, delay = 0 } = params;

    const { shouldV2BlockLegacy, shouldV2BlockLegacyGlobally } =
      await import('@/server/services/taskAutomation/mode');
    if (shouldV2BlockLegacyGlobally() || shouldV2BlockLegacy(params.workspaceId)) {
      log('skip redis heartbeat schedule task=%s: V2 owns workspace', taskId);
      return `v2-noop-${taskId}`;
    }

    this.ensureWorkers();

    const jobId = await this.getQueue().enqueue({
      delayMs: Math.max(0, delay) * 1000,
      maxAttempts: 8,
      name: JOB_NAMES.taskHeartbeatTick,
      payload: { taskId, userId },
    });

    log('Scheduled heartbeat tick task=%s delay=%ds jobId=%s', taskId, delay, jobId);
    return jobId;
  }

  async cancelScheduled(scheduleId: string): Promise<void> {
    if (!scheduleId) return;
    try {
      await this.getQueue().cancel(scheduleId);
      log('Canceled schedule %s', scheduleId);
    } catch (error) {
      log('cancelScheduled noop: %s %O', scheduleId, error);
    }
  }
}
