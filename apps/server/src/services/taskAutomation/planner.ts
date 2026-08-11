import type { TaskItem } from '@lobechat/types';
import debug from 'debug';

import { TaskAutomationModel } from '@/database/models/taskAutomation';
import type { LobeChatDatabase } from '@/database/type';

import { getTaskSchedulerV2Mode, shouldV2Plan } from './mode';
import {
  computeNextHeartbeatRunAt,
  computeNextScheduleRunAt,
  resolveOverdueFires,
} from './nextRun';
import { toModelScope } from './scope';

const log = debug('task-automation:planner');

export interface PlanDueResult {
  created: number;
  due: number;
  mode: ReturnType<typeof getTaskSchedulerV2Mode>;
  skipped: number;
}

/**
 * Planner: for each task with next_run_at <= now, insert logical automation
 * run(s) (ON CONFLICT DO NOTHING) and advance next_run_at.
 *
 * Shadow mode only logs — does not insert runs that would share dedupe keys.
 * Drain / off: no new plans.
 */
export async function planDueAutomationRuns(
  db: LobeChatDatabase,
  options: { limit?: number; now?: Date } = {},
): Promise<PlanDueResult> {
  const mode = getTaskSchedulerV2Mode();
  if (!shouldV2Plan()) {
    return { created: 0, due: 0, mode, skipped: 0 };
  }

  const now = options.now ?? new Date();
  const model = new TaskAutomationModel(db);
  const scope = toModelScope();
  const dueTasks = await model.listDueTasks(options.limit ?? 200, now, scope ?? undefined);

  let created = 0;
  let skipped = 0;

  for (const task of dueTasks) {
    const trigger =
      task.automationMode === 'heartbeat'
        ? ('heartbeat' as const)
        : task.automationMode === 'schedule'
          ? ('schedule' as const)
          : null;

    if (!trigger) {
      skipped += 1;
      continue;
    }

    // Heartbeat: single fire at nextRunAt (relative; overdue = fire once now-ish).
    // Schedule: apply overdue policy (latest | skip | all).
    const fires =
      trigger === 'schedule'
        ? resolveOverdueFires(task, now)
        : task.nextRunAt
          ? [{ missedCount: 0, plannedAt: new Date(task.nextRunAt) }]
          : [{ missedCount: 0, plannedAt: now }];

    // skip policy: no historical fire, just jump next_run_at forward
    if (trigger === 'schedule' && (task.overduePolicy ?? 'latest') === 'skip') {
      const next = computeNextScheduleRunAt(task, now);
      if (mode === 'shadow') {
        log('shadow skip-advance task=%s next=%s', task.id, next?.toISOString());
      }
      await model.setTaskNextRunAt(task.id, next);
      skipped += 1;
      continue;
    }

    if (fires.length === 0) {
      const next = computeFollowingNextRun(task, now);
      await model.setTaskNextRunAt(task.id, next);
      skipped += 1;
      continue;
    }

    if (mode === 'shadow') {
      for (const f of fires) {
        log(
          'shadow would-plan task=%s trigger=%s plannedAt=%s missed=%d',
          task.id,
          trigger,
          f.plannedAt.toISOString(),
          f.missedCount,
        );
      }
      const last = fires.at(-1)!.plannedAt;
      const next = computeFollowingNextRun(task, last);
      if (next) await model.setTaskNextRunAt(task.id, next);
      skipped += fires.length;
      continue;
    }

    let lastPlanned = fires[0].plannedAt;
    for (const f of fires) {
      const { created: wasCreated } = await model.insertRun({
        automationRevision: task.automationRevision ?? 0,
        missedCount: f.missedCount,
        plannedAt: f.plannedAt,
        taskId: task.id,
        trigger,
        userId: task.createdByUserId,
        workspaceId: task.workspaceId,
      });
      if (wasCreated) created += 1;
      else skipped += 1;
      lastPlanned = f.plannedAt;
    }

    const next = computeFollowingNextRun(task, lastPlanned);
    await model.setTaskNextRunAt(task.id, next);
  }

  log('plan: due=%d created=%d skipped=%d mode=%s', dueTasks.length, created, skipped, mode);
  return { created, due: dueTasks.length, mode, skipped };
}

/**
 * Ensure a task has next_run_at when automation is armed (status→scheduled).
 * Idempotent — only fills when nextRunAt is null.
 */
export async function ensureTaskNextRunAt(
  db: LobeChatDatabase,
  task: TaskItem,
  from: Date = new Date(),
): Promise<Date | null> {
  if (task.nextRunAt) return new Date(task.nextRunAt);

  let next: Date | null = null;
  if (task.automationMode === 'schedule') {
    next = computeNextScheduleRunAt(task, from);
  } else if (task.automationMode === 'heartbeat') {
    next = computeNextHeartbeatRunAt(task, from);
  }
  // event mode: next_run_at stays null until an event arrives

  if (next) {
    await new TaskAutomationModel(db).setTaskNextRunAt(task.id, next);
  }
  return next;
}

const computeFollowingNextRun = (task: TaskItem, after: Date): Date | null => {
  if (task.automationMode === 'schedule') {
    return computeNextScheduleRunAt(task, after);
  }
  if (task.automationMode === 'heartbeat') {
    return computeNextHeartbeatRunAt(task, after);
  }
  return null;
};
