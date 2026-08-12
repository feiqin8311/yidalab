// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMemoryDailyCronConfig,
  getTodayConversationWindow,
  isInDailyFireWindow,
  isMemoryDailyCronEnabled,
  stopMemoryDailyCron,
} from './dailyCron';

describe('memory dailyCron helpers', () => {
  const originalEnabled = process.env.MEMORY_DAILY_ANALYSIS_ENABLED;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.MEMORY_DAILY_ANALYSIS_TZ = 'Asia/Shanghai';
    process.env.MEMORY_DAILY_ANALYSIS_HOUR = '18';
    process.env.MEMORY_DAILY_ANALYSIS_MINUTE = '30';
  });

  afterEach(() => {
    stopMemoryDailyCron();
    vi.useRealTimers();
    delete process.env.MEMORY_DAILY_ANALYSIS_TZ;
    delete process.env.MEMORY_DAILY_ANALYSIS_HOUR;
    delete process.env.MEMORY_DAILY_ANALYSIS_MINUTE;
    if (originalEnabled === undefined) delete process.env.MEMORY_DAILY_ANALYSIS_ENABLED;
    else process.env.MEMORY_DAILY_ANALYSIS_ENABLED = originalEnabled;
  });

  it('is opt-in only (default off)', () => {
    delete process.env.MEMORY_DAILY_ANALYSIS_ENABLED;
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(isMemoryDailyCronEnabled()).toBe(false);
    process.env.MEMORY_DAILY_ANALYSIS_ENABLED = '1';
    expect(isMemoryDailyCronEnabled()).toBe(true);
  });

  it('reads config defaults for 18:30 Asia/Shanghai', () => {
    expect(getMemoryDailyCronConfig()).toEqual({
      hour: 18,
      minute: 30,
      tz: 'Asia/Shanghai',
    });
  });

  it('detects the 18:30 fire window in Asia/Shanghai', () => {
    // 2026-07-20 18:30:00 CST = 2026-07-20 10:30:00 UTC
    vi.setSystemTime(new Date('2026-07-20T10:30:00.000Z'));
    expect(isInDailyFireWindow()).toBe(true);

    vi.setSystemTime(new Date('2026-07-20T10:31:00.000Z'));
    expect(isInDailyFireWindow()).toBe(false);
  });

  it('builds today conversation window from local midnight to now', () => {
    vi.setSystemTime(new Date('2026-07-20T10:30:00.000Z'));
    const { dayKey, from, to } = getTodayConversationWindow();
    expect(dayKey).toBe('2026-07-20');
    // Asia/Shanghai midnight = previous day 16:00 UTC
    expect(from.toISOString()).toBe('2026-07-19T16:00:00.000Z');
    expect(to.toISOString()).toBe('2026-07-20T10:30:00.000Z');
  });
});
