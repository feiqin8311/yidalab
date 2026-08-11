import { describe, expect, it } from 'vitest';

import {
  clampPacingSeconds,
  computeNextCronRunAt,
  computeNextHeartbeatRunAt,
  computeNextScheduleRunAt,
  previewScheduleFires,
  resolveOverdueFires,
} from './nextRun';

describe('computeNextCronRunAt', () => {
  it('returns next daily fire after from', () => {
    const from = new Date('2026-08-11T00:00:00.000Z');
    const next = computeNextCronRunAt(
      {
        automationMode: 'schedule',
        schedulePattern: '0 9 * * *',
        scheduleTimezone: 'Asia/Shanghai',
      },
      from,
    );
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2026-08-11T01:00:00.000Z');
  });

  it('returns null for non-schedule mode', () => {
    expect(
      computeNextCronRunAt({
        automationMode: 'heartbeat',
        schedulePattern: '0 9 * * *',
        scheduleTimezone: 'UTC',
      }),
    ).toBeNull();
  });

  it('handles every-N-minutes pattern', () => {
    const from = new Date('2026-08-11T10:00:00.000Z');
    const next = computeNextCronRunAt(
      {
        automationMode: 'schedule',
        schedulePattern: '*/15 * * * *',
        scheduleTimezone: 'UTC',
      },
      from,
    );
    expect(next!.toISOString()).toBe('2026-08-11T10:15:00.000Z');
  });
});

describe('computeNextScheduleRunAt at/every', () => {
  it('at returns future scheduleAt', () => {
    const at = new Date('2026-08-12T12:00:00.000Z');
    const next = computeNextScheduleRunAt(
      {
        automationMode: 'schedule',
        scheduleAt: at,
        scheduleKind: 'at',
        schedulePattern: null,
        scheduleTimezone: 'UTC',
      } as any,
      new Date('2026-08-11T10:00:00.000Z'),
    );
    expect(next!.toISOString()).toBe(at.toISOString());
  });

  it('every anchors fixed wall-clock steps', () => {
    const next = computeNextScheduleRunAt(
      {
        automationMode: 'schedule',
        scheduleAnchorAt: new Date('2026-08-11T10:00:00.000Z'),
        scheduleEverySeconds: 3600,
        scheduleKind: 'every',
        schedulePattern: null,
        scheduleTimezone: 'UTC',
      } as any,
      new Date('2026-08-11T10:30:00.000Z'),
    );
    expect(next!.toISOString()).toBe('2026-08-11T11:00:00.000Z');
  });
});

describe('resolveOverdueFires', () => {
  it('latest collapses missed slots', () => {
    const fires = resolveOverdueFires(
      {
        automationMode: 'schedule',
        nextRunAt: new Date('2026-08-11T10:00:00.000Z'),
        overduePolicy: 'latest',
        scheduleEverySeconds: 3600,
        scheduleKind: 'every',
        scheduleAnchorAt: new Date('2026-08-11T10:00:00.000Z'),
        schedulePattern: null,
        scheduleTimezone: 'UTC',
      } as any,
      new Date('2026-08-11T13:30:00.000Z'),
    );
    expect(fires).toHaveLength(1);
    expect(fires[0].missedCount).toBeGreaterThan(0);
  });

  it('all returns up to 10 historical fires', () => {
    const fires = resolveOverdueFires(
      {
        automationMode: 'schedule',
        nextRunAt: new Date('2026-08-11T10:00:00.000Z'),
        overduePolicy: 'all',
        scheduleEverySeconds: 3600,
        scheduleKind: 'every',
        scheduleAnchorAt: new Date('2026-08-11T10:00:00.000Z'),
        schedulePattern: null,
        scheduleTimezone: 'UTC',
      } as any,
      new Date('2026-08-11T14:00:00.000Z'),
    );
    expect(fires.length).toBeGreaterThan(1);
    expect(fires.length).toBeLessThanOrEqual(10);
  });
});

describe('clampPacingSeconds', () => {
  it('clamps into bounds', () => {
    expect(clampPacingSeconds(10, {}).effective).toBe(600);
    expect(clampPacingSeconds(999_999, {}).effective).toBe(86_400);
    expect(
      clampPacingSeconds(1200, { pacingMinSeconds: 1000, pacingMaxSeconds: 2000 }).effective,
    ).toBe(1200);
  });
});

describe('previewScheduleFires', () => {
  it('returns N future fires', () => {
    const fires = previewScheduleFires(
      {
        automationMode: 'schedule',
        scheduleKind: 'every',
        scheduleEverySeconds: 3600,
        scheduleAnchorAt: new Date('2026-08-11T10:00:00.000Z'),
        schedulePattern: null,
        scheduleTimezone: 'UTC',
      } as any,
      3,
      new Date('2026-08-11T10:00:00.000Z'),
    );
    expect(fires).toHaveLength(3);
  });
});

describe('computeNextHeartbeatRunAt', () => {
  it('adds interval seconds', () => {
    const from = new Date('2026-08-11T10:00:00.000Z');
    const next = computeNextHeartbeatRunAt(
      { automationMode: 'heartbeat', heartbeatInterval: 600 },
      from,
    );
    expect(next!.toISOString()).toBe('2026-08-11T10:10:00.000Z');
  });

  it('returns null when interval missing', () => {
    expect(
      computeNextHeartbeatRunAt({ automationMode: 'heartbeat', heartbeatInterval: null }),
    ).toBeNull();
  });
});
