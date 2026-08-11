import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/server';

const log = debug('lobe-server:workflows:task:watchdog');

/**
 * Cron-style watchdog — delegates to unified V2 watchdog (stuck tasks +
 * expired claims + ledger timeouts + opportunistic cleanup).
 */
export async function watchdog(c: Context) {
  try {
    const db = await getServerDB();
    const { runTaskAutomationWatchdog } = await import('@/server/services/taskAutomation/watchdog');
    const result = await runTaskAutomationWatchdog(db);
    log(
      'Watchdog scan: checked=%d failed=%d ledgerTimedOut=%d recovered=%d',
      result.checked,
      result.failed.length,
      result.ledgerTimedOut,
      result.recovered,
    );
    return c.json(result);
  } catch (error) {
    console.error('[task/watchdog] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
