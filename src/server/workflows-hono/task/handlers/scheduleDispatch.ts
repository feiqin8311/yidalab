import debug from 'debug';
import type { Context } from 'hono';

import { runScheduleDispatchSweep } from '@/server/services/taskRunner/scheduleDispatchSweep';

const log = debug('lobe-server:workflows:task:schedule-dispatch');

export interface ScheduleDispatchPayload {
  /** When true, only return what would be dispatched without firing executes. */
  dryRun?: boolean;
}

/**
 * HTTP entry for the central schedule sweep.
 *
 * Production without QStash: also driven by in-process
 * `startScheduleDispatchCron` (every 10m). This route remains for external
 * cron / manual trigger / parity with the original QStash target URL.
 *
 * Signature verification (when configured) is handled by `qstashAuth`.
 */
export async function scheduleDispatch(c: Context) {
  try {
    const body = (await c.req.json().catch(() => ({}))) as ScheduleDispatchPayload;
    const { dryRun = false } = body ?? {};

    log('Received HTTP schedule-dispatch dryRun=%s', dryRun);
    const result = await runScheduleDispatchSweep({ dryRun });
    return c.json(result);
  } catch (error) {
    console.error('[task/schedule-dispatch] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
