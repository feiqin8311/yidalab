import {
  type AgentContextPolicy,
  DEFAULT_CONTEXT_BUDGETS,
  defaultReplaceContextPolicy,
} from '@lobechat/agent-runtime';
import { ToolNameResolver } from '@lobechat/context-engine';
import type { OperationsModeDef, OperationsToolApiRef } from '@lobechat/utils';

import { rewriteToolApisToInstalled } from './resolveWorkspacePlugin';

const resolver = new ToolNameResolver();

/** Always keep agent-document read for archived tool results. */
const ARCHIVE_READ_TOOLS: OperationsToolApiRef[] = [
  { apiName: 'readDocument', identifier: 'lobe-agent-documents', type: 'builtin' },
  { apiName: 'listDocuments', identifier: 'lobe-agent-documents', type: 'builtin' },
];

/**
 * Build replace-mode AgentContextPolicy for a fixed operations mode.
 * - toolScope.replace with API-level allow-list (or all APIs from resolved plugins)
 * - discovery off (no activator / skill store surface)
 * - default token budgets
 */
export const buildOpsContextPolicy = (opts: {
  mode: OperationsModeDef;
  /** Plugin identifiers available for this run (MCP etc.). */
  pluginIds: string[];
  /**
   * Optional manifest map identifier → { api: { name }[] } to expand
   * all APIs when mode.toolApis is empty.
   */
  manifestApis?: Record<string, Array<{ name: string; type?: string }>>;
}): AgentContextPolicy => {
  const { mode, pluginIds, manifestApis } = opts;
  const refs: OperationsToolApiRef[] = [...ARCHIVE_READ_TOOLS];

  if (mode.toolApis?.length) {
    // Rewrite DAG ids onto installed aliases so wire names match real plugins.
    refs.push(...rewriteToolApisToInstalled(mode.toolApis, pluginIds));
  } else if (manifestApis) {
    for (const pluginId of pluginIds) {
      const apis = manifestApis[pluginId];
      if (!apis?.length) continue;
      for (const api of apis) {
        refs.push({
          apiName: api.name,
          identifier: pluginId,
          type: api.type ?? 'mcp',
        });
      }
    }
  } else {
    // No API list yet — still restrict to plugin ids via wildcard expansion later;
    // emit placeholder names that ToolResolver filters by enabled plugins.
    // Callers should pass manifestApis when available.
    for (const pluginId of pluginIds) {
      refs.push({ apiName: '*', identifier: pluginId, type: 'mcp' });
    }
  }

  const concreteRefs = refs.filter((r) => r.apiName !== '*');
  // Only archive-read tools don't count as a full API allow-list — that would
  // block all MCP APIs. Plugin-level isolation (replace agentPlugins) still applies.
  const hasModeApiAllowList = concreteRefs.some((r) => r.identifier !== 'lobe-agent-documents');
  const allowedToolNames = hasModeApiAllowList
    ? [
        ...new Set(
          concreteRefs.map((r) => resolver.generate(r.identifier, r.apiName, r.type ?? 'mcp')),
        ),
      ]
    : undefined;

  const policy = defaultReplaceContextPolicy({
    allowedSkillNames: mode.skillNames,
    allowedToolNames: allowedToolNames ?? [],
  });

  return {
    ...policy,
    budgets: { ...DEFAULT_CONTEXT_BUDGETS, ...policy.budgets },
    toolScope: {
      // API-level replace only when mode.toolApis / manifestApis supplied.
      // Otherwise inherit wire-names (all APIs of injected plugins) + discovery off.
      mode: allowedToolNames?.length ? 'replace' : 'inherit',
      allowedToolNames,
      discovery: false,
    },
  };
};
