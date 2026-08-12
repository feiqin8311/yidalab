/**
 * Docker build wrapper: always restore full profile on exit (success or fail).
 * Usage: bun scripts/buildDocker.mts
 *        bun scripts/buildDocker.mts --full
 */
import { spawnSync } from 'node:child_process';

import { runDockerBuild } from './buildDockerLib';

const full = process.argv.includes('--full');

const run = (cmd: string, env?: Record<string, string>) => {
  const r = spawnSync(cmd, {
    env: { ...process.env, ...env },
    shell: true,
    stdio: 'inherit',
  });
  if (r.error) throw r.error;
  return r.status ?? 1;
};

const code = runDockerBuild({ full, run });
process.exit(code);
