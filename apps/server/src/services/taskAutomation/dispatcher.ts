import debug from 'debug';

import { TaskAutomationModel } from '@/database/models/taskAutomation';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { enqueueInternalJob } from '@/server/services/internalJob/enqueue';
import { JOB_NAMES } from '@/server/services/internalJob/types';

import { shouldV2Dispatch } from './mode';
import { toModelScope } from './scope';
import { processAutomationRun } from './worker';

const log = debug('task-automation:dispatcher');

export interface DispatchResult {
  dispatched: number;
  mode: 'inline' | 'queue' | 'off' | 'drain';
  pending: number;
}

/**
 * Dispatcher: load pending runs and wake workers with runId.
 * Redis is only a wake signal — may re-deliver freely; worker claim is DB-atomic.
 * Active in on + drain (drain finishes existing work only).
 */
export async function dispatchPendingAutomationRuns(
  db: LobeChatDatabase,
  options: { limit?: number } = {},
): Promise<DispatchResult> {
  if (!shouldV2Dispatch()) {
    return { dispatched: 0, mode: 'off', pending: 0 };
  }

  const model = new TaskAutomationModel(db);
  const scope = toModelScope();
  const runs = await model.listDispatchableRuns(
    options.limit ?? 100,
    new Date(),
    scope ?? undefined,
  );

  if (runs.length === 0) {
    return { dispatched: 0, mode: appEnv.enableQueueAgentRuntime ? 'queue' : 'inline', pending: 0 };
  }

  if (appEnv.enableQueueAgentRuntime) {
    let dispatched = 0;
    await Promise.all(
      runs.map(async (run) => {
        try {
          await enqueueInternalJob({
            // Dedupe so the same pending run is not stacked many times in ready list.
            dedupeKey: `task-auto-run:${run.id}`,
            name: JOB_NAMES.taskAutomationExecute,
            payload: { runId: run.id },
          });
          dispatched += 1;
        } catch (error) {
          console.error('[task-automation:dispatcher] enqueue failed run=%s: %O', run.id, error);
        }
      }),
    );
    log('queue dispatch: pending=%d dispatched=%d', runs.length, dispatched);
    return { dispatched, mode: 'queue', pending: runs.length };
  }

  // Inline / local: process each run in-process.
  let dispatched = 0;
  await Promise.all(
    runs.map(async (run) => {
      try {
        await processAutomationRun(db, run.id);
        dispatched += 1;
      } catch (error) {
        console.error('[task-automation:dispatcher] inline failed run=%s: %O', run.id, error);
      }
    }),
  );
  log('inline dispatch: pending=%d dispatched=%d', runs.length, dispatched);
  return { dispatched, mode: 'inline', pending: runs.length };
}
