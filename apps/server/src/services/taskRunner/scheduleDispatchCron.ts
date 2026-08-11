import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { runScheduleDispatchSweep } from '@/server/services/taskRunner/scheduleDispatchSweep';

const log = debug('task-runner:schedule-dispatch-cron');

/**
 * Same cadence as original LobeHub QStash schedule (every 10 minutes in
 * scripts/serverLauncher/startServer.js). Without QStash, this in-process
 * ticker is what actually makes task-page "定时计划" fire.
 */
const INTERVAL_MS = 10 * 60 * 1000;
/** Slightly under interval so the next tick can re-acquire after expiry. */
const LOCK_TTL_SEC = 9 * 60;
const LOCK_KEY = 'task:schedule-dispatch:cron-lock';
/** First sweep shortly after boot so local dev doesn't wait a full 10m. */
const FIRST_DELAY_MS = 15_000;

let timer: NodeJS.Timeout | null = null;
let firstTimer: NodeJS.Timeout | null = null;
let started = false;

/**
 * Default on for non-Vercel deploys with DATABASE_URL (Docker + local),
 * matching bot gateway / memory daily cron. Opt out: TASK_SCHEDULE_DISPATCH_CRON=0.
 */
export const isScheduleDispatchCronEnabled = (): boolean => {
  // Global V2 (on|drain, no allowlist): ticker not needed.
  // Scoped canary still needs this for out-of-scope workspaces.
  const mode = (process.env.TASK_SCHEDULER_V2 || 'off').toLowerCase().trim();
  const allowlist = (process.env.TASK_SCHEDULER_V2_WORKSPACES || '').trim();
  const globalV2 = (mode === 'on' || mode === 'drain') && (!allowlist || allowlist === '*');
  if (globalV2) return false;
  if (process.env.TASK_SCHEDULE_DISPATCH_CRON === '0') return false;
  if (process.env.TASK_SCHEDULE_DISPATCH_CRON === '1') return true;
  return Boolean(process.env.DATABASE_URL) && !process.env.VERCEL_ENV;
};

const tryAcquireTickLock = async (): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    // Single-process local: no multi-instance race.
    return true;
  }
  const result = await redis.set(LOCK_KEY, String(Date.now()), 'EX', LOCK_TTL_SEC, 'NX');
  return result === 'OK';
};

const tick = async () => {
  try {
    const acquired = await tryAcquireTickLock();
    if (!acquired) {
      log('skip tick: another instance holds the lock');
      return;
    }
    const result = await runScheduleDispatchSweep();
    log('tick done: total=%d due=%d dispatched=%d', result.total, result.due, result.dispatched);
  } catch (error) {
    console.error('[task.schedule-dispatch-cron] tick failed:', error);
  }
};

/**
 * Start the in-process schedule dispatcher (replaces QStash 10-minute schedule).
 * Idempotent. Call from Next.js instrumentation (nodejs runtime).
 */
export function startScheduleDispatchCron(): void {
  if (started) return;
  if (!isScheduleDispatchCronEnabled()) {
    log('disabled (TASK_SCHEDULE_DISPATCH_CRON=0, no DATABASE_URL, or on Vercel)');
    return;
  }

  started = true;
  console.info(
    '[task.schedule-dispatch-cron] started — sweeps every 10m (same as original QStash schedule)',
  );

  firstTimer = setTimeout(() => {
    void tick();
  }, FIRST_DELAY_MS);
  firstTimer.unref?.();

  timer = setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  timer.unref?.();
}

export function stopScheduleDispatchCron(): void {
  if (firstTimer) clearTimeout(firstTimer);
  if (timer) clearInterval(timer);
  firstTimer = null;
  timer = null;
  started = false;
}
