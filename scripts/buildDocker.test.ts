import { describe, expect, it } from 'vitest';

import { type DockerBuildRunner, runDockerBuild } from './buildDockerLib';

describe('runDockerBuild', () => {
  it('restores full profile after a failed middle step and keeps non-zero exit', () => {
    const calls: { cmd: string; env?: Record<string, string> }[] = [];
    let step = 0;
    const run: DockerBuildRunner = (cmd, env) => {
      calls.push({ cmd, env });
      // 0: apply internal, 1: rm mobile, 2: spa fails
      if (step === 0) {
        step++;
        expect(env?.YIDALAB_BUILD_PROFILE).toBe('internal');
        return 0;
      }
      if (step === 1) {
        step++;
        expect(cmd).toContain('rm -rf dist/mobile');
        return 0;
      }
      if (step === 2) {
        step++;
        return 42; // spa build fails
      }
      // finally restore
      expect(env?.YIDALAB_BUILD_PROFILE).toBe('full');
      expect(cmd).toContain('applyBuildProfile');
      return 0;
    };

    const code = runDockerBuild({ full: false, run });
    expect(code).toBe(42);
    expect(calls.at(-1)?.env?.YIDALAB_BUILD_PROFILE).toBe('full');
    expect(calls.some((c) => c.env?.YIDALAB_BUILD_PROFILE === 'internal')).toBe(true);
  });

  it('propagates restore failure when build otherwise succeeded', () => {
    const run: DockerBuildRunner = (cmd, env) => {
      if (env?.YIDALAB_BUILD_PROFILE === 'full' && cmd.includes('applyBuildProfile')) {
        // only the final restore fails
        return 7;
      }
      return 0;
    };
    expect(runDockerBuild({ full: true, run })).toBe(7);
  });

  it('skips rm dist/mobile for full profile', () => {
    const cmds: string[] = [];
    const run: DockerBuildRunner = (cmd) => {
      cmds.push(cmd);
      return 0;
    };
    expect(runDockerBuild({ full: true, run })).toBe(0);
    expect(cmds.some((c) => c.includes('rm -rf dist/mobile'))).toBe(false);
    expect(cmds.some((c) => c.includes('build:spa:mobile'))).toBe(true);
  });
});
