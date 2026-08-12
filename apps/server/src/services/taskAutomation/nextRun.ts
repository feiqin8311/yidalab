import type { TaskItem, TaskOverduePolicy } from '@lobechat/types';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface PlannedFire {
  missedCount: number;
  plannedAt: Date;
}

/**
 * Compute the next wall-clock fire time for a schedule-mode task.
 * Supports at / every / cron.
 */
export function computeNextScheduleRunAt(
  task: Pick<
    TaskItem,
    | 'automationMode'
    | 'scheduleKind'
    | 'schedulePattern'
    | 'scheduleTimezone'
    | 'scheduleAt'
    | 'scheduleEverySeconds'
    | 'scheduleAnchorAt'
  >,
  from: Date = new Date(),
): Date | null {
  if (task.automationMode !== 'schedule') return null;

  const kind = task.scheduleKind ?? (task.schedulePattern ? 'cron' : null);
  if (kind === 'at') {
    if (!task.scheduleAt) return null;
    const at = new Date(task.scheduleAt);
    return at.getTime() > from.getTime() ? at : null;
  }

  if (kind === 'every') {
    const every = task.scheduleEverySeconds;
    if (!every || every <= 0) return null;
    const anchor = task.scheduleAnchorAt ? new Date(task.scheduleAnchorAt) : from;
    if (anchor.getTime() > from.getTime()) return anchor;
    const elapsed = from.getTime() - anchor.getTime();
    const steps = Math.floor(elapsed / (every * 1000)) + 1;
    return new Date(anchor.getTime() + steps * every * 1000);
  }

  // cron (default)
  return computeNextCronRunAt(task, from);
}

/** @deprecated use computeNextScheduleRunAt — kept for call-site compatibility */
export function computeNextCronRunAt(
  task: Pick<TaskItem, 'automationMode' | 'schedulePattern' | 'scheduleTimezone'>,
  from: Date = new Date(),
): Date | null {
  if (task.automationMode !== 'schedule') return null;
  const pattern = task.schedulePattern?.trim();
  if (!pattern) return null;

  const parts = pattern.split(/\s+/);
  if (parts.length !== 5) return null;

  const [cronMinute, cronHour, , , cronWeekday] = parts;
  const tz = task.scheduleTimezone || 'UTC';

  let cursor = dayjs(from).tz(tz).startOf('minute').add(1, 'minute');
  const deadline = cursor.add(8, 'day');

  while (cursor.isBefore(deadline) || cursor.isSame(deadline)) {
    if (matchesCronFields(cursor, cronMinute, cronHour, cronWeekday)) {
      return cursor.utc().toDate();
    }
    cursor = cursor.add(1, 'minute');
  }

  return null;
}

export function computeNextHeartbeatRunAt(
  task: Pick<TaskItem, 'automationMode' | 'heartbeatInterval'>,
  from: Date = new Date(),
): Date | null {
  if (task.automationMode !== 'heartbeat') return null;
  const interval = task.heartbeatInterval;
  if (!interval || interval <= 0) return null;
  return new Date(from.getTime() + interval * 1000);
}

/**
 * Resolve overdue plan points between last planned (or nextRunAt) and now.
 * Returns fires the planner should insert.
 */
export function resolveOverdueFires(
  task: Pick<
    TaskItem,
    | 'automationMode'
    | 'scheduleKind'
    | 'schedulePattern'
    | 'scheduleTimezone'
    | 'scheduleAt'
    | 'scheduleEverySeconds'
    | 'scheduleAnchorAt'
    | 'overduePolicy'
    | 'nextRunAt'
  >,
  now: Date = new Date(),
): PlannedFire[] {
  if (!task.nextRunAt) return [];
  const next = new Date(task.nextRunAt);
  if (next.getTime() > now.getTime()) return [];

  const policy: TaskOverduePolicy = task.overduePolicy ?? 'latest';

  if (policy === 'skip') {
    // Jump to first future fire after now; no historical plan rows.
    const future = computeNextScheduleRunAt(task, now);
    if (!future) return [];
    // Caller advances next_run_at; no fire for the missed slot.
    return [];
  }

  if (policy === 'all') {
    const fires: PlannedFire[] = [];
    let cursor = next;
    let guard = 0;
    while (cursor.getTime() <= now.getTime() && guard < 10) {
      fires.push({ missedCount: 0, plannedAt: cursor });
      const following = computeNextScheduleRunAt(task, cursor);
      if (!following || following.getTime() <= cursor.getTime()) break;
      cursor = following;
      guard += 1;
    }
    return fires;
  }

  // latest (default): one fire at the most recent due slot, count missed.
  let cursor = next;
  let missed = 0;
  let last = next;
  let guard = 0;
  while (cursor.getTime() <= now.getTime() && guard < 10_000) {
    last = cursor;
    const following = computeNextScheduleRunAt(task, cursor);
    if (!following || following.getTime() <= cursor.getTime()) break;
    if (following.getTime() <= now.getTime()) missed += 1;
    cursor = following;
    guard += 1;
  }
  return [{ missedCount: missed, plannedAt: last }];
}

/** Preview next N fire times (for API/UI). */
export function previewScheduleFires(
  task: Pick<
    TaskItem,
    | 'automationMode'
    | 'scheduleKind'
    | 'schedulePattern'
    | 'scheduleTimezone'
    | 'scheduleAt'
    | 'scheduleEverySeconds'
    | 'scheduleAnchorAt'
    | 'heartbeatInterval'
  >,
  count = 5,
  from: Date = new Date(),
): Date[] {
  const result: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    let next: Date | null = null;
    if (task.automationMode === 'heartbeat') {
      next = computeNextHeartbeatRunAt(task, cursor);
    } else if (task.automationMode === 'schedule') {
      next = computeNextScheduleRunAt(task, cursor);
    }
    if (!next) break;
    result.push(next);
    cursor = next;
  }
  return result;
}

/**
 * Clamp a requested next-check into task pacing bounds.
 * Defaults: min 600, max 86400; hard ceiling 30 days.
 */
export function clampPacingSeconds(
  requestedSeconds: number,
  task: Pick<TaskItem, 'pacingMinSeconds' | 'pacingMaxSeconds'>,
): { effective: number; requested: number } {
  const HARD_MAX = 30 * 86_400;
  const min = task.pacingMinSeconds && task.pacingMinSeconds > 0 ? task.pacingMinSeconds : 600;
  const maxRaw =
    task.pacingMaxSeconds && task.pacingMaxSeconds > 0 ? task.pacingMaxSeconds : 86_400;
  const max = Math.min(maxRaw, HARD_MAX);
  const effective = Math.min(max, Math.max(min, requestedSeconds));
  return { effective, requested: requestedSeconds };
}

const matchesCronFields = (
  local: dayjs.Dayjs,
  cronMinute: string,
  cronHour: string,
  cronWeekday: string,
): boolean => {
  if (!fieldMatches(local.minute(), cronMinute, 0, 59)) return false;
  if (!fieldMatches(local.hour(), cronHour, 0, 23)) return false;
  if (cronWeekday !== '*' && !fieldMatches(local.day(), cronWeekday, 0, 6)) return false;
  return true;
};

const fieldMatches = (value: number, field: string, min: number, max: number): boolean => {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = Number.parseInt(field.slice(2), 10);
    if (!Number.isFinite(step) || step <= 0) return false;
    return value % step === 0;
  }
  if (field.includes(',')) {
    return field.split(',').some((part) => fieldMatches(value, part.trim(), min, max));
  }
  if (field.includes('-')) {
    const [a, b] = field.split('-').map((s) => Number.parseInt(s, 10));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return value >= a && value <= b;
  }
  const n = Number.parseInt(field, 10);
  if (!Number.isFinite(n) || n < min || n > max) return false;
  return value === n;
};
