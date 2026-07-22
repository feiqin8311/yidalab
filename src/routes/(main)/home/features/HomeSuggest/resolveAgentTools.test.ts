import { describe, expect, it } from 'vitest';

import { OPS_HOME_SUGGESTS, pickOpsHomeSuggests } from './opsHomeSuggests';
import {
  buildPromptsFromTools,
  isExcludedSuggestTool,
  resolveToolsForHomeSuggest,
} from './resolveAgentTools';

describe('isExcludedSuggestTool', () => {
  it('excludes platform plumbing (artifacts / memory / dingpan / …)', () => {
    expect(isExcludedSuggestTool('lobe-user-interaction')).toBe(true);
    expect(isExcludedSuggestTool('lobe-artifacts')).toBe(true);
    expect(isExcludedSuggestTool('lobe-user-memory')).toBe(true);
    expect(isExcludedSuggestTool('lobe-dingpan')).toBe(true);
    expect(isExcludedSuggestTool('lobe-notebook')).toBe(true);
    expect(isExcludedSuggestTool('lobe-cloud-sandbox')).toBe(true);
    expect(isExcludedSuggestTool('lobe-agent-documents')).toBe(true);
    expect(isExcludedSuggestTool('task')).toBe(true);
    expect(isExcludedSuggestTool('lobehub')).toBe(true);
  });

  it('excludes any remaining lobe-* platform id', () => {
    expect(isExcludedSuggestTool('lobe-something-new')).toBe(true);
  });

  it('keeps company market and third-party tools', () => {
    expect(isExcludedSuggestTool('company.mcp.sif-mcp')).toBe(false);
    expect(isExcludedSuggestTool('company.mcp.lingxing-mcp')).toBe(false);
    expect(isExcludedSuggestTool('gmail')).toBe(false);
  });
});

describe('resolveToolsForHomeSuggest', () => {
  it('drops inbox-pinned platform tools even when agentPluginIds lists them', () => {
    const tools = resolveToolsForHomeSuggest({
      agentPluginIds: [
        'lobe-user-interaction',
        'lobe-artifacts',
        'lobe-user-memory',
        'lobe-dingpan',
        'company.mcp.sif-mcp',
      ],
      getManifest: () => undefined,
      getMeta: (id) => {
        if (id === 'company.mcp.sif-mcp') {
          return { description: 'SIF traffic', title: 'SIF' };
        }
        if (id === 'lobe-dingpan') {
          return { description: 'Upload files to DingTalk Drive', title: '钉盘' };
        }
        return { description: 'platform', title: id };
      },
      installedTools: [],
    });

    expect(tools.map((t) => t.identifier)).toEqual(['company.mcp.sif-mcp']);
  });

  it('includes installed third-party tools', () => {
    const tools = resolveToolsForHomeSuggest({
      agentPluginIds: ['lobe-artifacts'],
      getManifest: () => undefined,
      getMeta: () => undefined,
      installedTools: [
        {
          description: 'Connected Gmail MCP',
          identifier: 'gmail',
          name: 'Gmail',
        },
      ],
    });

    expect(tools.map((t) => t.identifier)).toEqual(['gmail']);
  });
});

describe('buildPromptsFromTools', () => {
  it('prefers API-level prompts when available', () => {
    const items = buildPromptsFromTools(
      [
        {
          apis: [{ description: 'Query traffic', name: 'get_asin_traffic' }],
          description: 'SIF ops data',
          identifier: 'company.mcp.sif-mcp',
          name: 'SIF',
        },
      ],
      (key, opts) => `${key}:${opts?.name}:${opts?.apiDesc || opts?.description || ''}`,
      6,
    );

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('company.mcp.sif-mcp:get_asin_traffic');
    expect(items[0].title).toContain('SIF');
    expect(items[0].prompt).toContain('Query traffic');
  });

  it('uses description prompt when no APIs', () => {
    const items = buildPromptsFromTools(
      [
        {
          apis: [],
          description: '领星广告短查询',
          identifier: 'company.mcp.lingxing-mcp',
          name: '领星',
        },
      ],
      (key, opts) => `${key}|${opts?.name}|${opts?.description || ''}`,
      6,
    );

    expect(items[0].prompt).toContain('suggest.toolPromptWithDesc');
    expect(items[0].prompt).toContain('领星广告短查询');
  });
});

describe('pickOpsHomeSuggests', () => {
  it('returns up to maxItems from the catalog', () => {
    const items = pickOpsHomeSuggests(0, 6);
    expect(items).toHaveLength(6);
    expect(items.every((i) => i.title && i.prompt)).toBe(true);
  });

  it('reshuffles when token changes', () => {
    const a = pickOpsHomeSuggests(0, 6).map((i) => i.id);
    const b = pickOpsHomeSuggests(1, 6).map((i) => i.id);
    // Catalog is larger than 6; different seeds should not always match order
    expect(a).not.toEqual(b);
    expect(OPS_HOME_SUGGESTS.length).toBeGreaterThanOrEqual(6);
  });
});
