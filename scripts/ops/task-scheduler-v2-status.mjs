#!/usr/bin/env node
/**
 * Task Scheduler V2 ops status — open runs, pending age, mode reminder.
 *
 * Usage (from repo root, with DATABASE_URL):
 *   node scripts/ops/task-scheduler-v2-status.mjs
 *   node scripts/ops/task-scheduler-v2-status.mjs --workspace ws_xxx
 *   TASK_SCHEDULER_V2_WORKSPACES=ws_a,_personal_ node scripts/ops/task-scheduler-v2-status.mjs
 *
 * Exit 0 always (status tool). For gate scripts use task-scheduler-v2-drain-ready.mjs.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const loadEnv = (p) => {
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Z_]\w*$/i.test(key)) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
};
const env = { ...loadEnv(path.join(root, '.env')), ...process.env };

const args = process.argv.slice(2);
const wsIdx = args.indexOf('--workspace');
const workspaceFilter =
  wsIdx >= 0 ? args[wsIdx + 1] : (env.TASK_SCHEDULER_V2_WORKSPACES || '').trim() || null;

const mode = (env.TASK_SCHEDULER_V2 || 'off').toLowerCase().trim();

const parseAllowlist = (raw) => {
  if (!raw || raw === '*') return null;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length || parts.includes('*')) return null;
  return new Set(parts);
};

const allowlist = workspaceFilter
  ? workspaceFilter === '*'
    ? null
    : parseAllowlist(workspaceFilter)
  : parseAllowlist(env.TASK_SCHEDULER_V2_WORKSPACES || '');

const buildScopeSql = (col) => {
  if (!allowlist) return { sql: '', params: [] };
  const ids = [...allowlist].filter((id) => id !== '_personal_');
  const personal = allowlist.has('_personal_');
  const parts = [];
  const params = [];
  if (ids.length) {
    params.push(ids);
    parts.push(`${col} = ANY($${params.length})`);
  }
  if (personal) parts.push(`${col} IS NULL`);
  if (!parts.length) return { sql: ' AND false', params: [] };
  return { sql: ` AND (${parts.join(' OR ')})`, params };
};

const main = async () => {
  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  try {
    // Ensure tables exist (post-migration)
    const tables = await client.query(`
      SELECT to_regclass('public.task_automation_runs') AS runs,
             to_regclass('public.task_automation_run_attempts') AS attempts
    `);
    if (!tables.rows[0]?.runs) {
      console.error(
        'task_automation_runs missing — run db migrate first (0133_task_automation_ledger)',
      );
      process.exit(1);
    }

    const scope = buildScopeSql('workspace_id');
    const open = await client.query(
      `SELECT status, count(*)::int AS n
       FROM task_automation_runs
       WHERE status IN ('pending','running') ${scope.sql}
       GROUP BY status
       ORDER BY status`,
      scope.params,
    );

    const oldest = await client.query(
      `SELECT id, task_id, status, planned_at, trigger,
              EXTRACT(EPOCH FROM (now() - planned_at)) * 1000 AS age_ms
       FROM task_automation_runs
       WHERE status = 'pending' ${scope.sql}
       ORDER BY planned_at ASC
       LIMIT 5`,
      scope.params,
    );

    const expiredClaims = await client.query(
      `SELECT count(*)::int AS n
       FROM task_automation_run_attempts
       WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until < now()`,
    );

    const dueTasks = await client.query(
      `SELECT count(*)::int AS n FROM tasks
       WHERE next_run_at IS NOT NULL AND next_run_at <= now()
         AND automation_mode IN ('schedule','heartbeat')
         AND status NOT IN ('canceled','completed','failed','paused','running')
         ${buildScopeSql('workspace_id').sql}`,
      buildScopeSql('workspace_id').params,
    );

    const openTotal = open.rows.reduce((s, r) => s + r.n, 0);

    console.log(
      JSON.stringify(
        {
          mode,
          allowlist: allowlist ? [...allowlist] : '*',
          openRuns: Object.fromEntries(open.rows.map((r) => [r.status, r.n])),
          openTotal,
          oldestPending: oldest.rows.map((r) => ({
            id: r.id,
            taskId: r.task_id,
            trigger: r.trigger,
            plannedAt: r.planned_at,
            ageMs: Math.round(Number(r.age_ms)),
          })),
          expiredClaims: expiredClaims.rows[0]?.n ?? 0,
          dueTasks: dueTasks.rows[0]?.n ?? 0,
          drainReady: openTotal === 0,
          tip:
            mode === 'drain' && openTotal === 0
              ? 'Safe to set TASK_SCHEDULER_V2=off on all replicas'
              : mode === 'shadow'
                ? 'Shadow active — compare metrics before canary on'
                : null,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
