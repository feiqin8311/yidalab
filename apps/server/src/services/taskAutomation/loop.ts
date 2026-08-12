import debug from 'debug';

import { getServerDB } from '@/database/server';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { dispatchPendingAutomationRuns } from './dispatcher';
import { recordAutomationMetric } from './metrics';
import {
  getTaskSchedulerV2Mode,
  isTaskSchedulerV2Enabled,
  shouldV2Dispatch,
  shouldV2Plan,
} from './mode';
import { planDueAutomationRuns } from './planner';
import { recoverExpiredAutomationClaims } from './recovery';
import { toModelScope } from './scope';

const log = debug('task-automation:loop');

/**
 * Implementation-parameter sweep interval (not product semantics).
 * SLO target: 95% of wall-clock tasks start within 60s of plannedAt.
 * 30s is a reasonable default under minute-precision cron.
 */
const DEFAULT_INTERVAL_MS = 30_000;
const LOCK_KEY = 'task:automation:v2:loop-lock';
const LOCK_TTL_SEC = 25;
const FIRST_DELAY_MS = 10_000;

let timer: NodeJS.Timeout | null = null;
let firstTimer: NodeJS.Timeout | null = null;
let started = false;

const intervalMs = (): number => {
  const raw = Number.parseInt(process.env.TASK_SCHEDULER_V2_INTERVAL_MS || '', 10);
  return Number.isFinite(raw) && raw >= 5_000 ? raw : DEFAULT_INTERVAL_MS;
};

const tryLock = async (): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return true;
  const result = await redis.set(LOCK_KEY, String(Date.now()), 'EX', LOCK_TTL_SEC, 'NX');
  return result === 'OK';
};

const tick = async () => {
  const mode = getTaskSchedulerV2Mode();
  if (mode === 'off') return;

  try {
    const acquired = await tryLock();
    if (!acquired) {
      log('skip tick: lock held');
      return;
    }

    const db = await getServerDB();
    const planned = shouldV2Plan()
      ? await planDueAutomationRuns(db)
      : { created: 0, due: 0, mode, skipped: 0 };
    const recovered = shouldV2Dispatch()
      ? await recoverExpiredAutomationClaims(db)
      : { rebound: 0, released: 0, scanned: 0 };
    const dispatched = shouldV2Dispatch()
      ? await dispatchPendingAutomationRuns(db)
      : { dispatched: 0, mode: 'off' as const, pending: 0 };

    // Observability: oldest pending age + recovery counters + drain open count.
    try {
      const { TaskAutomationModel } = await import('@/database/models/taskAutomation');
      const autoModel = new TaskAutomationModel(db);
      const scope = toModelScope();
      const pending = await autoModel.listDispatchableRuns(1, new Date(), scope ?? undefined);
      if (pending[0]) {
        const ageMs = Date.now() - new Date(pending[0].plannedAt).getTime();
        recordAutomationMetric('pending_age_ms', ageMs, {
          mode,
          runId: pending[0].id,
          taskId: pending[0].taskId,
        });
      }
      if (mode === 'drain') {
        const open = await autoModel.countOpenRuns(scope ?? undefined);
        recordAutomationMetric('pending_age_ms', 0, { mode, openRuns: open });
        if (open === 0) {
          console.info(
            '[task-automation:loop] drain complete — open runs = 0; safe to set TASK_SCHEDULER_V2=off',
          );
        }
      }
    } catch {
      /* non-fatal */
    }
    if (recovered.released > 0) {
      recordAutomationMetric('claim_expired', recovered.released, { mode });
    }
    if (recovered.rebound > 0) {
      recordAutomationMetric('claim_rebound', recovered.rebound, { mode });
    }
    if (planned.created > 0) {
      recordAutomationMetric('planned', planned.created, { mode, due: planned.due });
    }

    log(
      'tick mode=%s planned=%d/%d recovered=%d dispatched=%d',
      mode,
      planned.created,
      planned.due,
      recovered.released,
      dispatched.dispatched,
    );
  } catch (error) {
    console.error('[task-automation:loop] tick failed:', error);
  }
};

/**
 * Start the V2 planner/dispatcher/recovery loop. Idempotent.
 * Only active when TASK_SCHEDULER_V2 is shadow|on.
 */
export function startTaskAutomationLoop(): void {
  if (started) return;
  if (!isTaskSchedulerV2Enabled()) {
    log('disabled (TASK_SCHEDULER_V2=%s)', getTaskSchedulerV2Mode());
    return;
  }
  if (!process.env.DATABASE_URL || process.env.VERCEL_ENV) {
    log('disabled (no DATABASE_URL or on Vercel)');
    return;
  }

  started = true;
  const ms = intervalMs();
  console.info(`[task-automation:loop] started — mode=${getTaskSchedulerV2Mode()} every ${ms}ms`);

  firstTimer = setTimeout(() => {
    void tick();
  }, FIRST_DELAY_MS);
  firstTimer.unref?.();

  timer = setInterval(() => {
    void tick();
  }, ms);
  timer.unref?.();
}

export function stopTaskAutomationLoop(): void {
  if (firstTimer) clearTimeout(firstTimer);
  if (timer) clearInterval(timer);
  firstTimer = null;
  timer = null;
  started = false;
}
