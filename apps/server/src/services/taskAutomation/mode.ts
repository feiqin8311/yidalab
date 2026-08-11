/**
 * Task Scheduler V2 feature flag + scoped canary + drain.
 *
 * Modes (TASK_SCHEDULER_V2):
 * - off    (default): legacy only
 * - shadow: plan/metrics only — no real ledger inserts that share dedupe keys
 * - on:     V2 plans + dispatches for in-scope workspaces; legacy blocked there
 * - drain:  no new plans; still dispatch/recover/complete existing V2 work;
 *           legacy stays blocked for in-scope workspaces until open runs = 0
 *
 * Scoped canary (TASK_SCHEDULER_V2_WORKSPACES):
 * - unset / empty / `*`: all workspaces (global)
 * - comma list of workspace ids: only those workspaces use V2
 * - include personal (null workspace) with token `_personal_`
 *
 * Same workspace is never dual-scheduled: either V2 owns it or legacy does.
 */

export type TaskSchedulerV2Mode = 'off' | 'shadow' | 'on' | 'drain';

export type V2QueryScope =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'filter'; includePersonal: boolean; workspaceIds: string[] };

export const getTaskSchedulerV2Mode = (): TaskSchedulerV2Mode => {
  const raw = (process.env.TASK_SCHEDULER_V2 || 'off').toLowerCase().trim();
  if (raw === 'on' || raw === 'shadow' || raw === 'off' || raw === 'drain') return raw;
  return 'off';
};

/** null = all workspaces; Set = allowlist (including `_personal_` for null workspaceId). */
export const getTaskSchedulerV2WorkspaceAllowlist = (): Set<string> | null => {
  const raw = (process.env.TASK_SCHEDULER_V2_WORKSPACES || '').trim();
  if (!raw || raw === '*') return null;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.includes('*')) return null;
  return new Set(parts);
};

export const getV2QueryScope = (): V2QueryScope => {
  const list = getTaskSchedulerV2WorkspaceAllowlist();
  if (!list) return { kind: 'all' };
  const workspaceIds = [...list].filter((id) => id !== '_personal_');
  const includePersonal = list.has('_personal_');
  if (workspaceIds.length === 0 && !includePersonal) return { kind: 'none' };
  return { kind: 'filter', includePersonal, workspaceIds };
};

export const isWorkspaceInV2Scope = (workspaceId: string | null | undefined): boolean => {
  const list = getTaskSchedulerV2WorkspaceAllowlist();
  if (!list) return true;
  if (workspaceId == null || workspaceId === '') return list.has('_personal_');
  return list.has(workspaceId);
};

/** V2 process is running at all (shadow | on | drain). */
export const isTaskSchedulerV2Enabled = (): boolean => {
  const mode = getTaskSchedulerV2Mode();
  return mode === 'on' || mode === 'shadow' || mode === 'drain';
};

/** Full dispatch authority for in-scope workspaces. */
export const isTaskSchedulerV2On = (): boolean => getTaskSchedulerV2Mode() === 'on';

export const isTaskSchedulerV2Shadow = (): boolean => getTaskSchedulerV2Mode() === 'shadow';

export const isTaskSchedulerV2Drain = (): boolean => getTaskSchedulerV2Mode() === 'drain';

/** Create new logical plans (shadow logs only; on inserts). Not during drain. */
export const shouldV2Plan = (): boolean => {
  const mode = getTaskSchedulerV2Mode();
  return mode === 'on' || mode === 'shadow';
};

/** Dispatch pending runs + recover claims. on | drain. */
export const shouldV2Dispatch = (): boolean => {
  const mode = getTaskSchedulerV2Mode();
  return mode === 'on' || mode === 'drain';
};

/**
 * Legacy timer/QStash/sweep must not start agents for this workspace.
 * True when mode is on|drain and workspace is in scope.
 */
export const shouldV2BlockLegacy = (workspaceId: string | null | undefined): boolean => {
  const mode = getTaskSchedulerV2Mode();
  if (mode !== 'on' && mode !== 'drain') return false;
  return isWorkspaceInV2Scope(workspaceId);
};

/**
 * Global legacy short-circuit: every workspace is V2-owned (on|drain, no allowlist).
 * When allowlist is set, legacy must stay alive for out-of-scope workspaces.
 */
export const shouldV2BlockLegacyGlobally = (): boolean => {
  const mode = getTaskSchedulerV2Mode();
  if (mode !== 'on' && mode !== 'drain') return false;
  return getTaskSchedulerV2WorkspaceAllowlist() === null;
};

/** Event ingress creates new plans only when fully on (not drain/shadow). */
export const shouldV2AcceptNewEvents = (): boolean => getTaskSchedulerV2Mode() === 'on';
