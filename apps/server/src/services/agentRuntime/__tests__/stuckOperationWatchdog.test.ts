// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
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

  it('abandons listed bot ops with the 12-minute deadline reason', async () => {
    const db = {
      select: vi.fn(),
    };
    const opRows = [{ id: 'op_1', topicId: 'tpc_1', userId: 'user_1' }];

    db.select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: async () => opRows,
        }),
      }),
    });

    const result = await runStuckBotOperationSweep(db as any, new Date('2026-08-13T06:00:00Z'));

    expect(result).toEqual({ abandoned: 1, checked: 1, failed: [] });
    expect(finalizeAbandoned).toHaveBeenCalledWith('op_1', 'bot_deadline_12m');
  });
});
