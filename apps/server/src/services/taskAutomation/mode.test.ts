import { afterEach, describe, expect, it } from 'vitest';

import {
  getTaskSchedulerV2Mode,
  getTaskSchedulerV2WorkspaceAllowlist,
  getV2QueryScope,
  isTaskSchedulerV2Enabled,
  isTaskSchedulerV2On,
  isTaskSchedulerV2Shadow,
  isWorkspaceInV2Scope,
  shouldV2AcceptNewEvents,
  shouldV2BlockLegacy,
  shouldV2BlockLegacyGlobally,
  shouldV2Dispatch,
  shouldV2Plan,
} from './mode';

describe('task scheduler V2 mode + canary + drain', () => {
  const originalMode = process.env.TASK_SCHEDULER_V2;
  const originalWs = process.env.TASK_SCHEDULER_V2_WORKSPACES;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.TASK_SCHEDULER_V2;
    else process.env.TASK_SCHEDULER_V2 = originalMode;
    if (originalWs === undefined) delete process.env.TASK_SCHEDULER_V2_WORKSPACES;
    else process.env.TASK_SCHEDULER_V2_WORKSPACES = originalWs;
  });

  it('defaults to off', () => {
    delete process.env.TASK_SCHEDULER_V2;
    expect(getTaskSchedulerV2Mode()).toBe('off');
    expect(isTaskSchedulerV2On()).toBe(false);
    expect(isTaskSchedulerV2Enabled()).toBe(false);
    expect(shouldV2Plan()).toBe(false);
    expect(shouldV2Dispatch()).toBe(false);
  });

  it('parses on / shadow / drain', () => {
    process.env.TASK_SCHEDULER_V2 = 'on';
    expect(isTaskSchedulerV2On()).toBe(true);
    expect(shouldV2Plan()).toBe(true);
    expect(shouldV2Dispatch()).toBe(true);
    expect(shouldV2AcceptNewEvents()).toBe(true);
    expect(shouldV2BlockLegacyGlobally()).toBe(true);

    process.env.TASK_SCHEDULER_V2 = 'shadow';
    expect(isTaskSchedulerV2Shadow()).toBe(true);
    expect(isTaskSchedulerV2On()).toBe(false);
    expect(shouldV2Plan()).toBe(true);
    expect(shouldV2Dispatch()).toBe(false);
    expect(shouldV2BlockLegacyGlobally()).toBe(false);

    process.env.TASK_SCHEDULER_V2 = 'drain';
    expect(shouldV2Plan()).toBe(false);
    expect(shouldV2Dispatch()).toBe(true);
    expect(shouldV2AcceptNewEvents()).toBe(false);
    expect(shouldV2BlockLegacyGlobally()).toBe(true);
  });

  it('workspace allowlist scopes canary', () => {
    process.env.TASK_SCHEDULER_V2 = 'on';
    process.env.TASK_SCHEDULER_V2_WORKSPACES = 'ws_a,ws_b,_personal_';

    expect(getTaskSchedulerV2WorkspaceAllowlist()?.has('ws_a')).toBe(true);
    expect(isWorkspaceInV2Scope('ws_a')).toBe(true);
    expect(isWorkspaceInV2Scope('ws_other')).toBe(false);
    expect(isWorkspaceInV2Scope(null)).toBe(true);
    expect(shouldV2BlockLegacy('ws_a')).toBe(true);
    expect(shouldV2BlockLegacy('ws_other')).toBe(false);
    // Not global — legacy must keep serving out-of-scope workspaces.
    expect(shouldV2BlockLegacyGlobally()).toBe(false);

    const scope = getV2QueryScope();
    expect(scope.kind).toBe('filter');
    if (scope.kind === 'filter') {
      expect(scope.workspaceIds).toEqual(expect.arrayContaining(['ws_a', 'ws_b']));
      expect(scope.includePersonal).toBe(true);
    }
  });

  it('empty / * / whitespace-only allowlist are global', () => {
    process.env.TASK_SCHEDULER_V2_WORKSPACES = '*';
    expect(getTaskSchedulerV2WorkspaceAllowlist()).toBeNull();
    expect(getV2QueryScope()).toEqual({ kind: 'all' });

    process.env.TASK_SCHEDULER_V2_WORKSPACES = '';
    expect(getTaskSchedulerV2WorkspaceAllowlist()).toBeNull();

    process.env.TASK_SCHEDULER_V2_WORKSPACES = '  ,  , ';
    expect(getTaskSchedulerV2WorkspaceAllowlist()).toBeNull();
  });

  it('trims and dedupes workspace ids; * mixed in list is global', () => {
    process.env.TASK_SCHEDULER_V2_WORKSPACES = ' ws_a , ws_a , ws_b ';
    const list = getTaskSchedulerV2WorkspaceAllowlist();
    expect(list?.size).toBe(2);
    expect(list?.has('ws_a')).toBe(true);
    expect(list?.has('ws_b')).toBe(true);

    process.env.TASK_SCHEDULER_V2_WORKSPACES = 'ws_a,*,ws_b';
    expect(getTaskSchedulerV2WorkspaceAllowlist()).toBeNull();
  });

  it('_personal_ matches only null/empty workspaceId', () => {
    process.env.TASK_SCHEDULER_V2 = 'on';
    process.env.TASK_SCHEDULER_V2_WORKSPACES = '_personal_';
    expect(isWorkspaceInV2Scope(null)).toBe(true);
    expect(isWorkspaceInV2Scope(undefined)).toBe(true);
    expect(isWorkspaceInV2Scope('')).toBe(true);
    expect(isWorkspaceInV2Scope('ws_x')).toBe(false);
    expect(shouldV2BlockLegacy(null)).toBe(true);
    expect(shouldV2BlockLegacy('ws_x')).toBe(false);
  });

  it('non-allowlist workspace is not V2-blocked under scoped canary', () => {
    process.env.TASK_SCHEDULER_V2 = 'on';
    process.env.TASK_SCHEDULER_V2_WORKSPACES = 'ws_canary';
    expect(shouldV2BlockLegacy('ws_other')).toBe(false);
    expect(shouldV2BlockLegacyGlobally()).toBe(false);
  });

  it('falls back to off for unknown values', () => {
    process.env.TASK_SCHEDULER_V2 = 'maybe';
    expect(getTaskSchedulerV2Mode()).toBe('off');
  });
});
