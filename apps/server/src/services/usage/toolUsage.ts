import type {
  ToolUsageApiRow,
  ToolUsageSkillRow,
  ToolUsageStats,
  ToolUsageToolRow,
  ToolUsageUserRow,
} from '@/types/usage/usageRecord';

/** Raw tool-call row loaded from message_plugins ⋈ messages. */
export interface ToolUsageRawRow {
  apiName: string | null;
  arguments: string | null;
  error: unknown;
  identifier: string | null;
  userId: string;
}

const TOP_N = 50;

export const isCompanyMcpIdentifier = (identifier: string | null | undefined): boolean =>
  !!identifier?.startsWith('company.mcp.');

export const isSkillActivation = (apiName: string | null | undefined): boolean =>
  apiName === 'activateSkill';

/**
 * Parse skill name from activateSkill tool arguments JSON.
 * Falls back to "unknown" when missing or malformed.
 */
export function parseSkillNameFromArguments(args: string | null | undefined): string {
  if (!args) return 'unknown';
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    const raw = parsed.name ?? parsed.skill ?? parsed.skillName;
    if (typeof raw !== 'string') return 'unknown';
    const name = raw.trim();
    return name || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Aggregate raw plugin rows into ToolUsageStats (in-memory, month-scoped). */
export function aggregateToolUsageRows(rows: ToolUsageRawRow[]): ToolUsageStats {
  const byToolMap = new Map<string, ToolUsageToolRow>();
  const byApiMap = new Map<string, ToolUsageApiRow>();
  const bySkillMap = new Map<string, ToolUsageSkillRow>();
  const byUserMap = new Map<string, ToolUsageUserRow>();

  let totalCalls = 0;
  let failedCalls = 0;
  let skillActivations = 0;
  let companyMcpCalls = 0;

  for (const row of rows) {
    const identifier = row.identifier?.trim() || 'unknown';
    const apiName = row.apiName?.trim() || 'unknown';
    const failed = row.error != null;
    totalCalls += 1;
    if (failed) failedCalls += 1;

    if (isCompanyMcpIdentifier(identifier)) companyMcpCalls += 1;

    const tool = byToolMap.get(identifier) ?? { calls: 0, failed: 0, identifier };
    tool.calls += 1;
    if (failed) tool.failed += 1;
    byToolMap.set(identifier, tool);

    const apiKey = `${identifier}\0${apiName}`;
    const api = byApiMap.get(apiKey) ?? { apiName, calls: 0, failed: 0, identifier };
    api.calls += 1;
    if (failed) api.failed += 1;
    byApiMap.set(apiKey, api);

    if (isSkillActivation(apiName)) {
      skillActivations += 1;
      const skillName = parseSkillNameFromArguments(row.arguments);
      const skill = bySkillMap.get(skillName) ?? {
        activations: 0,
        failed: 0,
        name: skillName,
      };
      skill.activations += 1;
      if (failed) skill.failed += 1;
      bySkillMap.set(skillName, skill);
    }

    const user = byUserMap.get(row.userId) ?? { calls: 0, failed: 0, userId: row.userId };
    user.calls += 1;
    if (failed) user.failed += 1;
    byUserMap.set(row.userId, user);
  }

  const sortByCalls = <T extends { calls: number }>(a: T, b: T) => b.calls - a.calls;
  const sortByActivations = (a: ToolUsageSkillRow, b: ToolUsageSkillRow) =>
    b.activations - a.activations;

  return {
    byApi: [...byApiMap.values()].sort(sortByCalls).slice(0, TOP_N),
    bySkill: [...bySkillMap.values()].sort(sortByActivations).slice(0, TOP_N),
    byTool: [...byToolMap.values()].sort(sortByCalls).slice(0, TOP_N),
    byUser: [...byUserMap.values()].sort(sortByCalls).slice(0, TOP_N),
    summary: {
      companyMcpCalls,
      failedCalls,
      skillActivations,
      totalCalls,
    },
  };
}
