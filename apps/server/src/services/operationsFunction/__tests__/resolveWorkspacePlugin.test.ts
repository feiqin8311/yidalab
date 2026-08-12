import { describe, expect, it } from 'vitest';

import {
  aliasGroupFor,
  installedAliasesFor,
  rewriteToolApisToInstalled,
} from '../resolveWorkspacePlugin';

describe('resolveWorkspacePlugin', () => {
  it('aliasGroupFor expands sif', () => {
    expect(aliasGroupFor('company.mcp.sif-mcp')).toEqual(
      expect.arrayContaining(['company.mcp.sif-mcp', 'sif-mcp']),
    );
    expect(aliasGroupFor('sif-mcp')).toEqual(
      expect.arrayContaining(['company.mcp.sif-mcp', 'sif-mcp']),
    );
  });

  it('installedAliasesFor only returns installed', () => {
    expect(installedAliasesFor('company.mcp.lingxing-mcp', ['company.mcp.sif-mcp'])).toEqual([]);
    expect(installedAliasesFor('company.mcp.sif-mcp', ['sif-mcp'])).toEqual(['sif-mcp']);
  });

  it('rewrite drops uninstalled optional plugins', () => {
    const out = rewriteToolApisToInstalled(
      [
        { apiName: 'ops_get_asin_traffic_trend', identifier: 'company.mcp.sif-mcp', type: 'mcp' },
        {
          apiName: 'ads_get_asin_ad_structure',
          identifier: 'company.mcp.lingxing-mcp',
          type: 'mcp',
        },
      ],
      ['sif-mcp'],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.identifier).toBe('sif-mcp');
  });
});
