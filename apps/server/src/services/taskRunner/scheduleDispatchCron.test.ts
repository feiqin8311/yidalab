import { afterEach, describe, expect, it } from 'vitest';

import { isScheduleDispatchCronEnabled } from './scheduleDispatchCron';

describe('isScheduleDispatchCronEnabled', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('is on by default when DATABASE_URL is set and not on Vercel', () => {
    process.env.DATABASE_URL = 'postgres://x';
    delete process.env.VERCEL_ENV;
    delete process.env.TASK_SCHEDULE_DISPATCH_CRON;
    expect(isScheduleDispatchCronEnabled()).toBe(true);
  });

  it('can be forced off', () => {
    process.env.DATABASE_URL = 'postgres://x';
    process.env.TASK_SCHEDULE_DISPATCH_CRON = '0';
    expect(isScheduleDispatchCronEnabled()).toBe(false);
  });

  it('is off on Vercel unless forced on', () => {
    process.env.DATABASE_URL = 'postgres://x';
    process.env.VERCEL_ENV = 'production';
    delete process.env.TASK_SCHEDULE_DISPATCH_CRON;
    expect(isScheduleDispatchCronEnabled()).toBe(false);

    process.env.TASK_SCHEDULE_DISPATCH_CRON = '1';
    expect(isScheduleDispatchCronEnabled()).toBe(true);
  });
});
