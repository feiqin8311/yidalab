#!/usr/bin/env node
/**
 * Exit 0 only when open V2 runs for the current scope are 0 (drain gate).
 *
 *   node scripts/ops/task-scheduler-v2-drain-ready.mjs
 *   node scripts/ops/task-scheduler-v2-drain-ready.mjs --workspace ws_xxx
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const statusScript = path.join(root, 'scripts/ops/task-scheduler-v2-status.mjs');

const r = spawnSync(process.execPath, [statusScript, ...process.argv.slice(2)], {
  encoding: 'utf8',
  env: process.env,
});

if (r.status !== 0) {
  process.stderr.write(r.stderr || r.stdout || 'status failed\n');
  process.exit(r.status || 1);
}

let data;
try {
  data = JSON.parse(r.stdout);
} catch {
  process.stderr.write(r.stdout);
  process.exit(1);
}

console.log(
  JSON.stringify(
    { drainReady: data.drainReady, openTotal: data.openTotal, mode: data.mode },
    null,
    2,
  ),
);
process.exit(data.drainReady ? 0 : 2);
