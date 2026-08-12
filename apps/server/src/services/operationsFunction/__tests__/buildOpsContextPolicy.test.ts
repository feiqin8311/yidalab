import { describe, expect, it } from 'vitest';

import { buildOpsContextPolicy } from '../buildOpsContextPolicy';

describe('buildOpsContextPolicy', () => {
  it('sets replace scope with discovery off when toolApis provided', () => {
    const policy = buildOpsContextPolicy({
      mode: {
        toolApis: [
          { apiName: 'trafficQuery', identifier: 'sif-mcp', type: 'mcp' },
          { apiName: 'rankTrend', identifier: 'sif-mcp', type: 'mcp' },
        ],
      } as any,
      pluginIds: ['sif-mcp'],
    });

    expect(policy.toolScope?.mode).toBe('replace');
    expect(policy.toolScope?.discovery).toBe(false);
    expect(policy.toolScope?.allowedToolNames?.length).toBeGreaterThan(0);
    expect(policy.budgets?.maxToolResultTokens).toBe(8_000);
  });

  it('uses inherit wire-names when no mode toolApis (plugin isolation only)', () => {
    const policy = buildOpsContextPolicy({
      mode: {} as any,
      pluginIds: ['sif-mcp'],
    });
    // discovery off; no API-level allow-list so MCP APIs of injected plugins work
    expect(policy.toolScope?.discovery).toBe(false);
    expect(policy.toolScope?.mode).toBe('inherit');
    expect(policy.toolScope?.allowedToolNames).toBeUndefined();
  });

  it('expands manifest APIs when mode.toolApis omitted', () => {
    const policy = buildOpsContextPolicy({
      mode: {} as any,
      pluginIds: ['sif-mcp'],
      manifestApis: {
        'sif-mcp': [
          { name: 'a', type: 'mcp' },
          { name: 'b', type: 'mcp' },
        ],
      },
    });
    expect(policy.toolScope?.mode).toBe('replace');
    expect(policy.toolScope?.allowedToolNames?.length).toBeGreaterThanOrEqual(2);
  });
});
