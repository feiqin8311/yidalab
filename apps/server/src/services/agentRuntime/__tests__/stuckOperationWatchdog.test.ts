// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  finalizeInactiveBotOperation,
  isStuckBotOperationWatchdogEnabled,
  resolveBotStuckAfterMs,
  runStuckBotOperationSweep,
} from '../stuckOperationWatchdog';

const finalizeAbandoned = vi.fn().mockResolvedValue({ abandoned: true });

vi.mock('../AbandonOperationService', () => ({
  AbandonOperationService: vi.fn().mockImplementation(() => ({ finalizeAbandoned })),
}));

describe('stuckOperationWatchdog', () => {
  beforeEach(() => {
    finalizeAbandoned.mockClear();
  });

  const selectResult = (rows: unknown[]) => {
    const query = {
      limit: vi.fn().mockResolvedValue(rows),
      orderBy: vi.fn(),
      where: vi.fn(),
    };
    query.orderBy.mockReturnValue(query);
    query.where.mockReturnValue(query);
    return { from: vi.fn().mockReturnValue(query) };
  };

  it('defaults to 12 minutes and can be overridden', () => {
    expect(resolveBotStuckAfterMs({})).toBe(12 * 60 * 1000);
    expect(resolveBotStuckAfterMs({ AGENT_BOT_STUCK_MS: '60000' })).toBe(60_000);
    expect(resolveBotStuckAfterMs({ AGENT_BOT_STUCK_MS: 'nope' })).toBe(12 * 60 * 1000);
  });

  it('is on when DATABASE_URL is set and not Vercel', () => {
    expect(isStuckBotOperationWatchdogEnabled({ DATABASE_URL: 'postgres://x' })).toBe(true);
    expect(
      isStuckBotOperationWatchdogEnabled({ DATABASE_URL: 'postgres://x', VERCEL_ENV: '1' }),
    ).toBe(false);
    expect(
      isStuckBotOperationWatchdogEnabled({
        AGENT_BOT_STUCK_CRON: '0',
        DATABASE_URL: 'postgres://x',
      }),
    ).toBe(false);
  });

  it('keeps an over-12-minute bot run alive when its journal is still active', async () => {
    const now = new Date('2026-08-13T06:00:00Z');
    const db = { select: vi.fn() };
    db.select
      .mockReturnValueOnce(
        selectResult([
          {
            createdAt: new Date('2026-08-13T05:40:00Z'),
            id: 'op-active',
            startedAt: new Date('2026-08-13T05:40:00Z'),
            status: 'running',
            trigger: 'bot',
          },
        ]),
      )
      .mockReturnValueOnce(selectResult([{ eventTimestamp: new Date('2026-08-13T05:59:50Z') }]));

    const result = await finalizeInactiveBotOperation(db as any, 'op-active', now);

    expect(result).toEqual({ abandoned: false, retryAfterMs: 710_000, status: 'active' });
    expect(finalizeAbandoned).not.toHaveBeenCalled();
  });

  it('abandons a bot run only after 12 minutes without journal activity', async () => {
    const now = new Date('2026-08-13T06:00:00Z');
    const db = { select: vi.fn() };
    db.select
      .mockReturnValueOnce(
        selectResult([
          {
            createdAt: new Date('2026-08-13T05:30:00Z'),
            id: 'op-stale',
            startedAt: new Date('2026-08-13T05:30:00Z'),
            status: 'running',
            trigger: 'bot',
          },
        ]),
      )
      .mockReturnValueOnce(selectResult([{ eventTimestamp: new Date('2026-08-13T05:47:00Z') }]));

    const result = await finalizeInactiveBotOperation(db as any, 'op-stale', now);

    expect(result).toEqual({ abandoned: true, status: 'abandoned' });
    expect(finalizeAbandoned).toHaveBeenCalledWith('op-stale', 'bot_deadline_12m');
  });

  it('sweeps listed bot ops through the activity-aware deadline guard', async () => {
    const db = {
      select: vi.fn(),
    };
    const opRows = [{ id: 'op_1', topicId: 'tpc_1', userId: 'user_1' }];

    db.select
      .mockReturnValueOnce(selectResult(opRows))
      .mockReturnValueOnce(
        selectResult([
          {
            createdAt: new Date('2026-08-13T05:30:00Z'),
            id: 'op_1',
            startedAt: new Date('2026-08-13T05:30:00Z'),
            status: 'running',
            trigger: 'bot',
          },
        ]),
      )
      .mockReturnValueOnce(selectResult([{ eventTimestamp: new Date('2026-08-13T05:47:00Z') }]));

    const result = await runStuckBotOperationSweep(db as any, new Date('2026-08-13T06:00:00Z'));

    expect(result).toEqual({ abandoned: 1, checked: 1, failed: [] });
    expect(finalizeAbandoned).toHaveBeenCalledWith('op_1', 'bot_deadline_12m');
  });
});
