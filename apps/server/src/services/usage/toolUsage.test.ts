import { describe, expect, it } from 'vitest';

import {
  aggregateToolUsageRows,
  isCompanyMcpIdentifier,
  isSkillActivation,
  parseSkillNameFromArguments,
  type ToolUsageRawRow,
} from './toolUsage';

describe('parseSkillNameFromArguments', () => {
  it('reads name / skill / skillName', () => {
    expect(parseSkillNameFromArguments(JSON.stringify({ name: 'artifacts' }))).toBe('artifacts');
    expect(parseSkillNameFromArguments(JSON.stringify({ skill: 'sif-ops' }))).toBe('sif-ops');
    expect(parseSkillNameFromArguments(JSON.stringify({ skillName: 'x' }))).toBe('x');
  });

  it('returns unknown for bad input', () => {
    expect(parseSkillNameFromArguments(null)).toBe('unknown');
    expect(parseSkillNameFromArguments('not-json')).toBe('unknown');
    expect(parseSkillNameFromArguments(JSON.stringify({}))).toBe('unknown');
    expect(parseSkillNameFromArguments(JSON.stringify({ name: '  ' }))).toBe('unknown');
  });
});

describe('isCompanyMcpIdentifier / isSkillActivation', () => {
  it('classifies company MCP and skill activations', () => {
    expect(isCompanyMcpIdentifier('company.mcp.sif-mcp')).toBe(true);
    expect(isCompanyMcpIdentifier('lobe-web-browsing')).toBe(false);
    expect(isSkillActivation('activateSkill')).toBe(true);
    expect(isSkillActivation('activateTools')).toBe(false);
  });
});

describe('aggregateToolUsageRows', () => {
  const rows: ToolUsageRawRow[] = [
    {
      apiName: 'ops_get_asin_traffic_trend',
      arguments: null,
      error: null,
      identifier: 'company.mcp.sif-mcp',
      userId: 'u1',
    },
    {
      apiName: 'ops_get_asin_traffic_trend',
      arguments: null,
      error: { message: 'fail' },
      identifier: 'company.mcp.sif-mcp',
      userId: 'u1',
    },
    {
      apiName: 'query_asin_ads',
      arguments: null,
      error: null,
      identifier: 'company.mcp.lingxing-mcp',
      userId: 'u2',
    },
    {
      apiName: 'activateSkill',
      arguments: JSON.stringify({ name: 'artifacts' }),
      error: null,
      identifier: 'lobe-skills',
      userId: 'u1',
    },
    {
      apiName: 'activateSkill',
      arguments: JSON.stringify({ name: 'artifacts' }),
      error: null,
      identifier: 'lobe-skills',
      userId: 'u2',
    },
    {
      apiName: 'search',
      arguments: null,
      error: null,
      identifier: 'lobe-web-browsing',
      userId: 'u2',
    },
  ];

  it('aggregates summary, tools, skills, apis, and users', () => {
    const stats = aggregateToolUsageRows(rows);

    expect(stats.summary).toEqual({
      companyMcpCalls: 3,
      failedCalls: 1,
      skillActivations: 2,
      totalCalls: 6,
    });

    expect(stats.byTool.find((t) => t.identifier === 'company.mcp.sif-mcp')).toMatchObject({
      calls: 2,
      failed: 1,
    });
    expect(stats.bySkill).toEqual([{ activations: 2, failed: 0, name: 'artifacts' }]);
    expect(stats.byUser.map((u) => u.userId).sort()).toEqual(['u1', 'u2']);
    expect(
      stats.byApi.find(
        (a) => a.identifier === 'company.mcp.sif-mcp' && a.apiName === 'ops_get_asin_traffic_trend',
      ),
    ).toMatchObject({ calls: 2, failed: 1 });
  });

  it('returns empty structure for no rows', () => {
    const stats = aggregateToolUsageRows([]);
    expect(stats.summary.totalCalls).toBe(0);
    expect(stats.byTool).toEqual([]);
    expect(stats.bySkill).toEqual([]);
  });
});
