import { DEFAULT_BRIEF_ACTIONS } from '@lobechat/types';
import debug from 'debug';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskAutomationModel } from '@/database/models/taskAutomation';
import type { LobeChatDatabase } from '@/database/type';

import { cleanupOldAutomationRuns } from './completion';
import { shouldV2Dispatch } from './mode';
import { recoverExpiredAutomationClaims } from './recovery';

const log = debug('task-automation:watchdog');

export interface WatchdogResult {
  checked: number;
  failed: string[];
  ledgerTimedOut: number;
  message: string;
  recovered: number;
  success: true;
}

/**
 * Unified watchdog:
 * 1. Legacy stuck tasks (status=running + heartbeatTimeout)
 * 2. V2 expired claims recovery
 * 3. V2 long-running attempts past execution timeout
 * 4. Opportunistic 180-day ledger cleanup (small batch)
 */
export async function runTaskAutomationWatchdog(db: LobeChatDatabase): Promise<WatchdogResult> {
  const stuckTasks = await TaskModel.findStuckTasks(db);
  const failed: string[] = [];

  for (const task of stuckTasks) {
    const wsId = task.workspaceId ?? undefined;
    const model = new TaskModel(db, task.createdByUserId, wsId);
    await model.updateStatus(task.id, 'failed', {
      completedAt: new Date(),
      error: 'Heartbeat timeout',
    });

    const briefModel = new BriefModel(db, task.createdByUserId, wsId);
    await briefModel.create({
      actions: DEFAULT_BRIEF_ACTIONS['error'],
      agentId: task.assigneeAgentId || undefined,
      priority: 'urgent',
      summary: `Task has been running without heartbeat update for more than ${task.heartbeatTimeout} seconds.`,
      taskId: task.id,
      title: `${task.identifier} heartbeat timeout`,
      trigger: 'task',
      type: 'error',
    });

    failed.push(task.identifier);
  }

  let recovered = 0;
  let ledgerTimedOut = 0;

  if (shouldV2Dispatch()) {
    const recovery = await recoverExpiredAutomationClaims(db);
    recovered = recovery.released + recovery.rebound;

    const autoModel = new TaskAutomationModel(db);
    const timedOut = await autoModel.listTimedOutRunningAttempts(50);
    const rows = (timedOut as { rows?: any[] }).rows ?? (Array.isArray(timedOut) ? timedOut : []);

    for (const row of rows as Array<{
      attempt_id: string;
      identifier: string;
      operation_id: string | null;
      task_id: string;
      user_id: string;
      workspace_id: string | null;
    }>) {
      await autoModel.completeAttempt({
        attemptId: row.attempt_id,
        errorCode: 'execution_timeout',
        errorMessage: 'Automation attempt exceeded heartbeatTimeout',
        status: 'failed',
      });
      ledgerTimedOut += 1;

      try {
        const briefModel = new BriefModel(db, row.user_id, row.workspace_id ?? undefined);
        await briefModel.create({
          actions: DEFAULT_BRIEF_ACTIONS['error'],
          priority: 'urgent',
          summary: 'Automation attempt exceeded execution timeout.',
          taskId: row.task_id,
          title: `${row.identifier} automation timeout`,
          trigger: 'task',
          type: 'error',
        });
      } catch (e) {
        log('timeout brief failed: %O', e);
      }
    }

    // Opportunistic cleanup — never blocks watchdog.
    void cleanupOldAutomationRuns(db).catch((e) => log('cleanup failed: %O', e));
  }

  return {
    checked: stuckTasks.length,
    failed,
    ledgerTimedOut,
    message:
      failed.length > 0 || ledgerTimedOut > 0
        ? `${failed.length} stuck tasks, ${ledgerTimedOut} ledger timeouts`
        : 'No stuck tasks found',
    recovered,
    success: true,
  };
}
