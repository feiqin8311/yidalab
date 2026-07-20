import { isExecutionTime } from '@lobechat/utils/cronEval';
import debug from 'debug';

import { TaskModel } from '@/database/models/task';
import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { enqueueInternalJob } from '@/server/services/internalJob/enqueue';
import { JOB_NAMES } from '@/server/services/internalJob/types';
import { runScheduleTick } from '@/server/services/taskRunner/scheduleTick';

const log = debug('task-runner:schedule-dispatch');

export interface ScheduleDispatchSweepOptions {
  /** When true, only report due tasks without firing executes. */
  dryRun?: boolean;
}

export interface ScheduleDispatchSweepResult {
  dispatched: number;
  dryRun: boolean;
  due: number;
  skipped: number;
  success: true;
  total: number;
}

interface DueTask {
  pattern: string;
  taskId: string;
  taskIdentifier: string;
  timezone: string | null;
  userId: string;
}

/**
 * Central schedule sweep — same logic the original QStash cron hit every 10m:
 * load schedule-mode tasks, filter by cron + timezone, fan-out executes.
 *
 * Fan-out uses Redis internal jobs when `AGENT_RUNTIME_MODE=queue`, else
 * runs `runScheduleTick` inline (local / dev).
 */
export async function runScheduleDispatchSweep(
  options: ScheduleDispatchSweepOptions = {},
): Promise<ScheduleDispatchSweepResult> {
  const { dryRun = false } = options;

  const db = await getServerDB();
  const tasks = await TaskModel.getScheduledTasks(db);

  const now = new Date();
  const due: DueTask[] = [];
  for (const task of tasks) {
    if (!task.schedulePattern) continue;
    const matches = isExecutionTime({
      cronPattern: task.schedulePattern,
      currentTime: now,
      lastExecutedAt: task.lastHeartbeatAt ?? null,
      timezone: task.scheduleTimezone,
    });
    if (!matches) continue;
    due.push({
      pattern: task.schedulePattern,
      taskId: task.id,
      taskIdentifier: task.identifier,
      timezone: task.scheduleTimezone,
      userId: task.createdByUserId,
    });
  }

  log(
    'scan: total=%d due=%d skipped=%d dryRun=%s',
    tasks.length,
    due.length,
    tasks.length - due.length,
    dryRun,
  );

  if (dryRun || due.length === 0) {
    return {
      dispatched: 0,
      dryRun,
      due: due.length,
      skipped: tasks.length - due.length,
      success: true,
      total: tasks.length,
    };
  }

  const dispatched = await fanout(due);

  return {
    dispatched,
    dryRun: false,
    due: due.length,
    skipped: tasks.length - due.length,
    success: true,
    total: tasks.length,
  };
}

const fanout = async (due: DueTask[]): Promise<number> => {
  // Queue mode: one internal job per due task (replaces QStash publish).
  if (appEnv.enableQueueAgentRuntime) {
    const results = await Promise.allSettled(
      due.map((d) =>
        enqueueInternalJob({
          name: JOB_NAMES.taskScheduleExecute,
          payload: { taskId: d.taskId, userId: d.userId },
        }),
      ),
    );

    let dispatched = 0;
    for (const [i, r] of results.entries()) {
      if (r.status === 'fulfilled') {
        dispatched += 1;
      } else {
        console.error(
          '[task/schedule-dispatch] failed to enqueue task=%s identifier=%s: %O',
          due[i].taskId,
          due[i].taskIdentifier,
          r.reason,
        );
      }
    }
    return dispatched;
  }

  // Local / dev: invoke runScheduleTick directly.
  const results = await Promise.allSettled(due.map((d) => runScheduleTick(d.taskId, d.userId)));
  let dispatched = 0;
  for (const [i, r] of results.entries()) {
    if (r.status === 'fulfilled') {
      dispatched += 1;
    } else {
      console.error(
        '[task/schedule-dispatch] inline tick failed task=%s: %O',
        due[i].taskId,
        r.reason,
      );
    }
  }
  return dispatched;
};
