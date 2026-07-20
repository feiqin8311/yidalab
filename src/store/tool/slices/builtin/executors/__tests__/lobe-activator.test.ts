/**
 * Tests for Lobe Tools Executor (activateTools discovery allowlist)
 * + ExecutionRuntime identifier normalize / company.mcp summary
 */
import {
  ActivatorExecutionRuntime,
  normalizeActivationIdentifier,
  normalizeActivationIdentifiers,
  summarizeApiDescription,
  type ToolManifestInfo,
} from '@lobechat/builtin-tool-activator/executionRuntime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock getToolStoreState
const mockGetState = vi.fn();
vi.mock('@/store/tool', () => ({
  getToolStoreState: () => mockGetState(),
}));

// Mock toolSelectors.availableToolsForDiscovery
const mockAvailableToolsForDiscovery = vi.fn();
vi.mock('@/store/tool/selectors/tool', () => ({
  toolSelectors: {
    availableToolsForDiscovery: (s: any) => mockAvailableToolsForDiscovery(s),
  },
}));

// Import after mocks
const { activatorExecutor } = await import('../lobe-activator');

const makeBuiltinTool = (identifier: string, discoverable?: boolean) => ({
  discoverable,
  identifier,
  manifest: {
    api: [{ description: `${identifier} api`, name: 'run' }],
    meta: { avatar: '🔧', description: `${identifier} desc`, title: identifier },
    systemRole: `You are ${identifier}`,
  },
});

const makePlugin = (identifier: string) => ({
  identifier,
  manifest: {
    api: [{ description: `${identifier} api`, name: 'execute' }],
    meta: { avatar: '🔌', description: `${identifier} desc`, title: identifier },
    systemRole: `Plugin ${identifier}`,
  },
});

describe('lobe-activator executor discovery allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should only return manifests for discoverable tools', async () => {
    const discoverableTool = makeBuiltinTool('web-browsing');
    const hiddenTool = makeBuiltinTool('internal-admin', false);

    mockGetState.mockReturnValue({
      builtinTools: [discoverableTool, hiddenTool],
      installedPlugins: [],
    });

    // Only web-browsing is discoverable
    mockAvailableToolsForDiscovery.mockReturnValue([
      { description: 'desc', identifier: 'web-browsing', name: 'web-browsing' },
    ]);

    const result = await activatorExecutor.invoke(
      'activateTools',
      {
        identifiers: ['web-browsing', 'internal-admin'],
        reason: 'Use web browsing to answer the current request.',
      },
      { messageId: 'msg-1', operationId: 'op-1' },
    );

    expect(result.success).toBe(true);

    const state = result.state as any;
    const activatedIds = state.activatedTools?.map((t: any) => t.identifier) ?? [];

    expect(activatedIds).toContain('web-browsing');
    expect(activatedIds).not.toContain('internal-admin');
  }, 10_000);

  it('should reject all identifiers when none are discoverable', async () => {
    const hiddenTool = makeBuiltinTool('secret-tool', false);

    mockGetState.mockReturnValue({
      builtinTools: [hiddenTool],
      installedPlugins: [],
    });

    mockAvailableToolsForDiscovery.mockReturnValue([]);

    const result = await activatorExecutor.invoke(
      'activateTools',
      {
        identifiers: ['secret-tool'],
        reason: 'Use the secret tool to answer the current request.',
      },
      { messageId: 'msg-1', operationId: 'op-1' },
    );

    expect(result.success).toBe(true);

    const state = result.state as any;
    const activatedIds = state.activatedTools?.map((t: any) => t.identifier) ?? [];
    expect(activatedIds).toHaveLength(0);
  });

  it('should allow discoverable plugins', async () => {
    const plugin = makePlugin('community-plugin');

    mockGetState.mockReturnValue({
      builtinTools: [],
      installedPlugins: [plugin],
    });

    mockAvailableToolsForDiscovery.mockReturnValue([
      { description: 'desc', identifier: 'community-plugin', name: 'community-plugin' },
    ]);

    const result = await activatorExecutor.invoke(
      'activateTools',
      {
        identifiers: ['community-plugin'],
        reason: 'Use the plugin to answer the current request.',
      },
      { messageId: 'msg-1', operationId: 'op-1' },
    );

    expect(result.success).toBe(true);

    const state = result.state as any;
    const activatedIds = state.activatedTools?.map((t: any) => t.identifier) ?? [];
    expect(activatedIds).toContain('community-plugin');
  });

  it('should resolve tool____api identifiers to the parent discoverable tool', async () => {
    const web = makeBuiltinTool('lobe-web-browsing');

    mockGetState.mockReturnValue({
      builtinTools: [web],
      installedPlugins: [],
    });

    mockAvailableToolsForDiscovery.mockReturnValue([
      { description: 'desc', identifier: 'lobe-web-browsing', name: 'Web Browsing' },
    ]);

    const result = await activatorExecutor.invoke(
      'activateTools',
      {
        identifiers: ['lobe-web-browsing____search', 'lobe-web-browsing____crawlMultiPages'],
        reason: 'Need ASIN research via web tools.',
      },
      { messageId: 'msg-1', operationId: 'op-1' },
    );

    expect(result.success).toBe(true);
    const state = result.state as any;
    expect(state.activatedTools?.map((t: any) => t.identifier)).toEqual(['lobe-web-browsing']);
    expect(state.notFound ?? []).toEqual([]);
  });
});

describe('activation identifier normalize helpers', () => {
  it('strips function-call form and dedupes', () => {
    expect(normalizeActivationIdentifier('lobe-web-browsing____search')).toBe('lobe-web-browsing');
    expect(
      normalizeActivationIdentifiers([
        'lobe-web-browsing____search',
        'lobe-web-browsing____crawlMultiPages',
        'company.mcp.sif-mcp',
        'company.mcp.sif-mcp____ops_get_asin_traffic_trend',
      ]),
    ).toEqual(['lobe-web-browsing', 'company.mcp.sif-mcp']);
  });

  it('summarizes multi-line API docs to one short line', () => {
    const long =
      '功能：查询某 ASIN 历史全量的广告流量趋势，按 SP/SB/SBV 三个渠道分别输出曝光量时序。\n触发时机：xxx';
    const short = summarizeApiDescription(long, 40);
    expect(short).not.toContain('\n');
    expect(short.length).toBeLessThanOrEqual(40);
    expect(short.endsWith('…')).toBe(true);
  });
});

describe('ActivatorExecutionRuntime company.mcp summary', () => {
  const makeRuntime = (manifests: ToolManifestInfo[]) => {
    const getToolManifests = vi.fn(async (ids: string[]) =>
      manifests.filter((m) => ids.includes(m.identifier)),
    );
    const markActivated = vi.fn();
    return {
      getToolManifests,
      markActivated,
      runtime: new ActivatorExecutionRuntime({
        service: {
          getActivatedToolIds: () => [],
          getToolManifests,
          markActivated,
        },
      }),
    };
  };

  it('maps tool____api to parent and activates once', async () => {
    const { runtime, getToolManifests, markActivated } = makeRuntime([
      {
        apiDescriptions: [{ description: 'Search the web', name: 'search' }],
        identifier: 'lobe-web-browsing',
        name: 'Web Browsing',
        systemRole: 'You can browse the web.',
      },
    ]);

    const result = await runtime.activateTools({
      identifiers: ['lobe-web-browsing____search', 'lobe-web-browsing____crawlMultiPages'],
      reason: 'Need search',
    });

    expect(result.success).toBe(true);
    expect(getToolManifests).toHaveBeenCalledWith(['lobe-web-browsing']);
    expect(markActivated).toHaveBeenCalledWith(['lobe-web-browsing']);
    expect((result.state as any).notFound).toEqual([]);
  });

  it('returns summary-only content for company.mcp tools', async () => {
    const hugeDoc = [
      '功能：查询某 ASIN 历史全量的广告流量趋势，按 SP/SB/SBV 三个渠道分别输出曝光量时序。',
      '触发时机：需要初步定位广告流量变化发生的时间窗口',
      '注意：很长很长的说明'.repeat(50),
    ].join('\n');

    const { runtime } = makeRuntime([
      {
        apiDescriptions: [
          { description: hugeDoc, name: 'ops_get_asin_traffic_trend' },
          {
            description: '功能：按 ASIN 查广告结构\n更多细节…',
            name: 'ads_get_asin_ad_structure',
          },
        ],
        identifier: 'company.mcp.sif-mcp',
        name: 'sif-mcp',
        systemRole: '【重要】完成分析后必须输出 render_footer…' + 'x'.repeat(5000),
      },
    ]);

    const result = await runtime.activateTools({
      identifiers: ['company.mcp.sif-mcp'],
      reason: 'ASIN analysis',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('ops_get_asin_traffic_trend');
    expect(result.content).toContain('ads_get_asin_ad_structure');
    expect(result.content).not.toContain('render_footer');
    expect(result.content).not.toContain('触发时机：');
    expect(result.content.length).toBeLessThan(800);
  });

  it('keeps full content for non-company tools', async () => {
    const { runtime } = makeRuntime([
      {
        apiDescriptions: [{ description: 'Search the web deeply', name: 'search' }],
        identifier: 'lobe-web-browsing',
        name: 'Web Browsing',
        systemRole: 'Full system role for web browsing.',
      },
    ]);

    const result = await runtime.activateTools({
      identifiers: ['lobe-web-browsing'],
      reason: 'browse',
    });

    expect(result.content).toContain('Full system role for web browsing.');
    expect(result.content).toContain('Search the web deeply');
  });
});
