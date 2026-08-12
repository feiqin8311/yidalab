/**
 * Docker build orchestration (testable).
 */
export type DockerBuildRunner = (cmd: string, env?: Record<string, string>) => number;

export type DockerBuildOptions = {
  full?: boolean;
  run: DockerBuildRunner;
};

/**
 * Apply profile → build SPA/next → metrics → always restore full.
 * Returns the process exit code to propagate.
 */
export function runDockerBuild({ full = false, run }: DockerBuildOptions): number {
  const profile = full ? 'full' : 'internal';
  let code = 1;

  const restoreFull = () =>
    run('bun scripts/applyBuildProfile.ts', { YIDALAB_BUILD_PROFILE: 'full' });

  try {
    code = run('bun scripts/applyBuildProfile.ts', { YIDALAB_BUILD_PROFILE: profile });
    if (code !== 0) throw new Error(`applyBuildProfile failed: ${code}`);

    if (!full) {
      code = run('rm -rf dist/mobile');
      if (code !== 0) throw new Error(`rm dist/mobile failed: ${code}`);
    }

    const spa = full
      ? 'cross-env NODE_OPTIONS=--max-old-space-size=4096 pnpm run build:spa && cross-env NODE_OPTIONS=--max-old-space-size=4096 pnpm run build:spa:mobile && cross-env NODE_OPTIONS=--max-old-space-size=4096 pnpm run build:spa:auth'
      : 'cross-env NODE_OPTIONS=--max-old-space-size=4096 YIDALAB_BUILD_PROFILE=internal pnpm run build:spa && cross-env NODE_OPTIONS=--max-old-space-size=4096 YIDALAB_BUILD_PROFILE=internal pnpm run build:spa:auth';

    code = run(spa);
    if (code !== 0) throw new Error(`spa build failed: ${code}`);

    code = run('pnpm run build:spa:copy');
    if (code !== 0) throw new Error(`spa copy failed: ${code}`);

    code = run(
      full
        ? 'cross-env NODE_OPTIONS=--max-old-space-size=4096 DOCKER=true next build'
        : 'cross-env NODE_OPTIONS=--max-old-space-size=4096 YIDALAB_BUILD_PROFILE=internal DOCKER=true next build',
    );
    if (code !== 0) throw new Error(`next build failed: ${code}`);

    code = run('bun scripts/buildMetrics.mts', { YIDALAB_BUILD_PROFILE: profile });
    if (code !== 0) throw new Error(`buildMetrics failed: ${code}`);
  } catch {
    code = typeof code === 'number' && code !== 0 ? code : 1;
  } finally {
    const restoreCode = restoreFull();
    if (restoreCode !== 0) {
      code = code === 0 ? restoreCode : code;
    }
  }

  return code;
}
