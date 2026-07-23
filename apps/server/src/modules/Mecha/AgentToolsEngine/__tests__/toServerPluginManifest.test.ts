import { describe, expect, it } from 'vitest';

import { toServerPluginManifest } from '../index';

describe('toServerPluginManifest', () => {
  it('hydrates mcpParams from customParams.mcp', () => {
    const manifest = toServerPluginManifest({
      customParams: {
        mcp: { headers: { 'secret-key': 'x' }, type: 'http', url: 'https://mcp.sif.com/mcp' },
      },
      identifier: 'company.mcp.sif-mcp',
      manifest: {
        api: [{ description: 'd', name: 'foo', parameters: { type: 'object' } }],
        identifier: 'company.mcp.sif-mcp',
        meta: { title: 'SIF' },
        type: 'mcp',
      },
      type: 'plugin',
    } as any) as any;

    expect(manifest?.type).toBe('mcp');
    expect(manifest?.mcpParams).toMatchObject({
      name: 'company.mcp.sif-mcp',
      type: 'http',
      url: 'https://mcp.sif.com/mcp',
    });
  });

  it('returns base when no mcp customParams', () => {
    const base = {
      api: [{ description: 'd', name: 'a', parameters: {} }],
      identifier: 'x',
    };
    const manifest = toServerPluginManifest({
      identifier: 'x',
      manifest: base,
      type: 'plugin',
    } as any);
    expect(manifest).toEqual(base);
  });
});
