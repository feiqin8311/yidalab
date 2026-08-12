import { afterEach, describe, expect, it } from 'vitest';

import {
  getYidaLabProcessRole,
  isInternalBuildProfile,
  shouldRunResidentWorkers,
  YIDALAB_BUILD_PROFILE,
} from './buildProfile';

describe('buildProfile', () => {
  const originalProfile = process.env.YIDALAB_BUILD_PROFILE;
  const originalRole = process.env.YIDALAB_PROCESS_ROLE;

  afterEach(() => {
    if (originalProfile === undefined) delete process.env.YIDALAB_BUILD_PROFILE;
    else process.env.YIDALAB_BUILD_PROFILE = originalProfile;
    if (originalRole === undefined) delete process.env.YIDALAB_PROCESS_ROLE;
    else process.env.YIDALAB_PROCESS_ROLE = originalRole;
  });

  it('defaults process role to all (run workers)', () => {
    delete process.env.YIDALAB_PROCESS_ROLE;
    expect(getYidaLabProcessRole()).toBe('all');
    expect(shouldRunResidentWorkers()).toBe(true);
  });

  it('web role skips resident workers', () => {
    process.env.YIDALAB_PROCESS_ROLE = 'web';
    expect(getYidaLabProcessRole()).toBe('web');
    expect(shouldRunResidentWorkers()).toBe(false);
  });

  it('worker role runs resident workers', () => {
    process.env.YIDALAB_PROCESS_ROLE = 'worker';
    expect(shouldRunResidentWorkers()).toBe(true);
  });

  it('exports a build profile string', () => {
    expect(YIDALAB_BUILD_PROFILE === 'full' || YIDALAB_BUILD_PROFILE === 'internal').toBe(true);
    expect(typeof isInternalBuildProfile()).toBe('boolean');
  });
});
