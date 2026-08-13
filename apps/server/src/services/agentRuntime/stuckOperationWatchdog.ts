import debug from 'debug';
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';

import { agentOperations } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { BOT_DEADLINE_MS } from '@/server/services/bot/botContextPolicy';

import { AbandonOperationService } from './AbandonOperationService';

const log = debug('lobe-server:stuck-op-watchdog');

/** Bot IM runs should not spin past this wall clock. Override: AGENT_BOT_STUCK_MS. */
export const DEFAULT_BOT_STUCK_MS = BOT_DEADLINE_MS;
const INTERVAL_MS = 2 * 60 * 1000;
const LOCK_TTL_SEC = 90;
const LOCK_KEY = 'agent:stuck-bot-op:cron-lock';
const SWEEP_LIMIT = 20;

const STUCK_STATUSES = ['running', 'waiting_for_async_tool'] as const;

type WatchdogEnv = Record<string, string | undefined>;

export const resolveBotStuckAfterMs = (env: WatchdogEnv = process.env): number => {
  const raw = env.AGENT_BOT_STUCK_MS;
  if (!raw) return DEFAULT_BOT_STUCK_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BOT_STUCK_MS;
};

export const isStuckBotOperationWatchdogEnabled = (env: WatchdogEnv = process.env): boolean => {
  if (env.AGENT_BOT_STUCK_CRON === '0') return false;
  if (env.AGENT_BOT_STUCK_CRON === '1') return true;
  return Boolean(env.DATABASE_URL) && !env.VERCEL_ENV;
};

export interface StuckBotOpSweepResult {
  abandoned: number;
  checked: number;
  failed: string[];
}

export async function runStuckBotOperationSweep(
  db: LobeChatDatabase,
  now: Date = new Date(),
): Promise<StuckBotOpSweepResult> {
  const cutoff = new Date(now.getTime() - resolveBotStuckAfterMs());
  const rows = await db
    .select({
      id: agentOperations.id,
      topicId: agentOperations.topicId,
      userId: agentOperations.userId,
    })
    .from(agentOperations)
    .where(
      and(
        inArray(agentOperations.status, [...STUCK_STATUSES]),
        eq(agentOperations.trigger, 'bot'),
        lt(agentOperations.startedAt, cutoff),
        isNull(agentOperations.completedAt),
      ),
    )
    .limit(SWEEP_LIMIT);

  const result: StuckBotOpSweepResult = { abandoned: 0, checked: rows.length, failed: [] };
  if (rows.length === 0) return result;

  const abandon = new AbandonOperationService(db);
  const reason = 'bot_deadline_12m';

  for (const row of rows) {
    try {
      await abandon.finalizeAbandoned(row.id, reason);
      result.abandoned++;
    } catch (error) {
      log('[%s] abandon failed: %O', row.id, error);
      result.failed.push(row.id);
    }
  }

  return result;
}

let timer: NodeJS.Timeout | null = null;
let firstTimer: NodeJS.Timeout | null = null;
let started = false;

const tryAcquireTickLock = async (): Promise<boolean> => {
  const { getAgentRuntimeRedisClient } = await import('@/server/modules/AgentRuntime/redis');
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return true;
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
    const { getServerDB } = await import('@/database/core/db-adaptor');
    const db = await getServerDB();
    const result = await runStuckBotOperationSweep(db);
    if (result.checked > 0) {
      log(
        'tick done: checked=%d abandoned=%d failed=%d',
        result.checked,
        result.abandoned,
        result.failed.length,
      );
    }
  } catch (error) {
    console.error('[stuck-bot-op-watchdog] tick failed:', error);
  }
};

export function startStuckBotOperationWatchdog(): void {
  if (started) return;
  if (!isStuckBotOperationWatchdogEnabled()) {
    log('disabled');
    return;
  }

  started = true;
  console.info(
    '[stuck-bot-op-watchdog] started — sweeps every %ds (stuck after %ds)',
    INTERVAL_MS / 1000,
    resolveBotStuckAfterMs() / 1000,
  );

  firstTimer = setTimeout(() => {
    void tick();
  }, 20_000);
  firstTimer.unref?.();

  timer = setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  timer.unref?.();
}

export function stopStuckBotOperationWatchdog(): void {
  if (firstTimer) clearTimeout(firstTimer);
  if (timer) clearInterval(timer);
  firstTimer = null;
  timer = null;
  started = false;
}
