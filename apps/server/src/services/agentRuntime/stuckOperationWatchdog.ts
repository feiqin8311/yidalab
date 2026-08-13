import debug from 'debug';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';

import { agentOperations, agentRuntimeJournal } from '@/database/schemas';
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

export interface BotDeadlineResult {
  abandoned: boolean;
  retryAfterMs?: number;
  status: 'abandoned' | 'active' | 'missing_or_terminal';
}

/**
 * Finalize a bot operation only after it has produced no durable runtime
 * activity for the full deadline window. The operation's start time remains
 * the fallback for older runs without protocol journal rows.
 */
export async function finalizeInactiveBotOperation(
  db: LobeChatDatabase,
  operationId: string,
  now: Date = new Date(),
): Promise<BotDeadlineResult> {
  const [operation] = await db
    .select({
      createdAt: agentOperations.createdAt,
      id: agentOperations.id,
      startedAt: agentOperations.startedAt,
      status: agentOperations.status,
      trigger: agentOperations.trigger,
    })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId))
    .limit(1);

  if (
    !operation ||
    operation.trigger !== 'bot' ||
    !STUCK_STATUSES.includes(operation.status as (typeof STUCK_STATUSES)[number])
  ) {
    return { abandoned: false, status: 'missing_or_terminal' };
  }

  const [latestJournalRow] = await db
    .select({ eventTimestamp: agentRuntimeJournal.eventTimestamp })
    .from(agentRuntimeJournal)
    .where(eq(agentRuntimeJournal.operationId, operationId))
    .orderBy(desc(agentRuntimeJournal.sequence))
    .limit(1);

  const lastActivityAt =
    latestJournalRow?.eventTimestamp ?? operation.startedAt ?? operation.createdAt;
  const inactiveForMs = Math.max(0, now.getTime() - lastActivityAt.getTime());
  const inactiveAfterMs = resolveBotStuckAfterMs();

  if (inactiveForMs < inactiveAfterMs) {
    return {
      abandoned: false,
      retryAfterMs: Math.max(1000, inactiveAfterMs - inactiveForMs),
      status: 'active',
    };
  }

  await new AbandonOperationService(db).finalizeAbandoned(operationId, 'bot_deadline_12m');
  return { abandoned: true, status: 'abandoned' };
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

  for (const row of rows) {
    try {
      const deadline = await finalizeInactiveBotOperation(db, row.id, now);
      if (deadline.abandoned) result.abandoned++;
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
