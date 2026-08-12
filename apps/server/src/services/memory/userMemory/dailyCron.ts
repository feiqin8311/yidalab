import dayjs from 'dayjs';
import timezonePlugin from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { enqueueInternalJob } from '@/server/services/internalJob/enqueue';
import { JOB_NAMES } from '@/server/services/internalJob/types';

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

const log = debug('lobe-server:memory:daily-cron');

const DEFAULT_TZ = 'Asia/Shanghai';
const DEFAULT_HOUR = 18;
const DEFAULT_MINUTE = 30;
const TICK_MS = 30_000;
const LOCK_TTL_SEC = 60 * 60 * 26; // cover a full day + margin

let timer: NodeJS.Timeout | null = null;
let started = false;

const envInt = (key: string, fallback: number) => {
  const n = Number(process.env[key]);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

/**
 * Whether the daily memory analysis cron is enabled.
 * Default: on when REDIS_URL is available and not explicitly disabled.
 */
export const isMemoryDailyCronEnabled = (): boolean => {
  // Explicit opt-in only — do not auto-start just because Redis exists.
  if (process.env.MEMORY_DAILY_ANALYSIS_ENABLED === '1') return true;
  return false;
};

export const getMemoryDailyCronConfig = () => {
  const tz = process.env.MEMORY_DAILY_ANALYSIS_TZ || DEFAULT_TZ;
  const hour = envInt('MEMORY_DAILY_ANALYSIS_HOUR', DEFAULT_HOUR);
  const minute = envInt('MEMORY_DAILY_ANALYSIS_MINUTE', DEFAULT_MINUTE);
  return { hour, minute, tz };
};

/**
 * Compute [startOfLocalDay, now] in the configured timezone for "today's chats".
 */
export const getTodayConversationWindow = (now = new Date()) => {
  const { tz } = getMemoryDailyCronConfig();
  const local = dayjs(now).tz(tz);
  const from = local.startOf('day').toDate();
  const to = local.toDate();
  const dayKey = local.format('YYYY-MM-DD');
  return { dayKey, from, to, tz };
};

/**
 * True when local clock is in the fire window [target, target+1min).
 */
export const isInDailyFireWindow = (now = new Date()): boolean => {
  const { hour, minute, tz } = getMemoryDailyCronConfig();
  const local = dayjs(now).tz(tz);
  return local.hour() === hour && local.minute() === minute;
};

/**
 * Acquire once-per-day lock (Redis NX). Returns true if this instance should fire.
 */
export const tryAcquireDailyLock = async (dayKey: string): Promise<boolean> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    // Single-process without Redis: use in-memory last-run only (dev).
    return true;
  }
  const key = `memory:daily-cron:lock:${dayKey}`;
  const result = await redis.set(key, String(Date.now()), 'EX', LOCK_TTL_SEC, 'NX');
  return result === 'OK';
};

/**
 * Enqueue one `memory.daily` job for today's conversation window.
 */
export async function fireMemoryDailyAnalysis(now = new Date()) {
  const { dayKey, from, to, tz } = getTodayConversationWindow(now);
  const acquired = await tryAcquireDailyLock(dayKey);
  if (!acquired) {
    log('skip fire: lock held for day=%s', dayKey);
    return { enqueued: false, reason: 'lock_held' as const, dayKey };
  }

  const jobId = await enqueueInternalJob({
    dedupeKey: `memory.daily:${dayKey}`,
    name: JOB_NAMES.memoryDaily,
    payload: {
      baseUrl: process.env.APP_URL || 'http://localhost',
      dayKey,
      from: from.toISOString(),
      to: to.toISOString(),
    },
  });

  log('enqueued memory.daily jobId=%s day=%s tz=%s from=%s to=%s', jobId, dayKey, tz, from, to);
  return { dayKey, enqueued: true as const, jobId };
}

let lastFiredDayKey: string | null = null;

const tick = async () => {
  try {
    if (!isInDailyFireWindow()) return;

    const { dayKey } = getTodayConversationWindow();
    // In-memory guard for multi-tick within the same minute (no Redis).
    if (lastFiredDayKey === dayKey) return;

    const result = await fireMemoryDailyAnalysis();
    if (result.enqueued) {
      lastFiredDayKey = dayKey;
    }
  } catch (error) {
    console.error('[memory.daily-cron] tick failed:', error);
  }
};

/**
 * Start the in-process daily memory analysis scheduler (18:30 Asia/Shanghai by default).
 * Idempotent. Call from Next.js instrumentation (nodejs runtime).
 */
export function startMemoryDailyCron(): void {
  if (started) return;
  if (!isMemoryDailyCronEnabled()) {
    log('disabled (MEMORY_DAILY_ANALYSIS_ENABLED=0 or no REDIS_URL / on Vercel)');
    return;
  }

  started = true;
  const { hour, minute, tz } = getMemoryDailyCronConfig();
  console.info(
    `[memory.daily-cron] started — fires daily at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${tz}`,
  );

  void tick();
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  timer.unref?.();
}

export function stopMemoryDailyCron(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  lastFiredDayKey = null;
}
