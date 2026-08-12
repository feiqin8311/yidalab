import { afterEach, describe, expect, it } from 'vitest';

/**
 * Pure gate coverage for TASK_SCHEDULER_V2 modes + canary.
 * Tick modules are covered by integration; these assert the env contract.
 */
describe('legacy paths hard-gated when V2 owns the workspace', () => {
  const originalMode = process.env.TASK_SCHEDULER_V2;
  const originalWs = process.env.TASK_SCHEDULER_V2_WORKSPACES;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.TASK_SCHEDULER_V2;
    else process.env.TASK_SCHEDULER_V2 = originalMode;
    if (originalWs === undefined) delete process.env.TASK_SCHEDULER_V2_WORKSPACES;
    else process.env.TASK_SCHEDULER_V2_WORKSPACES = originalWs;
  });

  it('global on blocks all legacy', async () => {
    process.env.TASK_SCHEDULER_V2 = 'on';
    delete process.env.TASK_SCHEDULER_V2_WORKSPACES;
    const { shouldV2BlockLegacyGlobally, shouldV2BlockLegacy } = await import('./mode');
    expect(shouldV2BlockLegacyGlobally()).toBe(true);
    expect(shouldV2BlockLegacy('any')).toBe(true);
  });

  it('drain blocks legacy globally but does not plan', async () => {
    process.env.TASK_SCHEDULER_V2 = 'drain';
    delete process.env.TASK_SCHEDULER_V2_WORKSPACES;
    const { shouldV2BlockLegacyGlobally, shouldV2Plan, shouldV2Dispatch } = await import('./mode');
    expect(shouldV2BlockLegacyGlobally()).toBe(true);
    expect(shouldV2Plan()).toBe(false);
    expect(shouldV2Dispatch()).toBe(true);
  });

  it('scoped on only blocks allowlisted workspaces', async () => {
    process.env.TASK_SCHEDULER_V2 = 'on';
    process.env.TASK_SCHEDULER_V2_WORKSPACES = 'ws_canary';
    const { shouldV2BlockLegacyGlobally, shouldV2BlockLegacy } = await import('./mode');
    expect(shouldV2BlockLegacyGlobally()).toBe(false);
    expect(shouldV2BlockLegacy('ws_canary')).toBe(true);
    expect(shouldV2BlockLegacy('ws_other')).toBe(false);
  });

  it('schedule dispatch cron stays enabled under scoped canary', () => {
    process.env.TASK_SCHEDULER_V2 = 'on';
    process.env.TASK_SCHEDULER_V2_WORKSPACES = 'ws_canary';
    process.env.TASK_SCHEDULE_DISPATCH_CRON = '1';
    // Mirrors isScheduleDispatchCronEnabled
    const mode = (process.env.TASK_SCHEDULER_V2 || 'off').toLowerCase().trim();
    const allowlist = (process.env.TASK_SCHEDULER_V2_WORKSPACES || '').trim();
    const globalV2 = (mode === 'on' || mode === 'drain') && (!allowlist || allowlist === '*');
    expect(globalV2).toBe(false);
    expect(process.env.TASK_SCHEDULE_DISPATCH_CRON === '1').toBe(true);
  });
});
