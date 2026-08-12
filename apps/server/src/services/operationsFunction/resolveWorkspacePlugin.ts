import type { OperationsToolApiRef } from '@lobechat/utils';
import { CAPABILITY_PLUGIN_CANDIDATES } from '@lobechat/utils';

/**
 * Alias group for a capability / plugin id (e.g. company.mcp.sif-mcp ↔ sif-mcp).
 * Never used for cross-workspace lookup — only to map DAG ids onto *installed* pluginIds.
 */
export const aliasGroupFor = (identifier: string): string[] => {
  const cap = CAPABILITY_PLUGIN_CANDIDATES[identifier as keyof typeof CAPABILITY_PLUGIN_CANDIDATES];
  if (cap?.length) return [identifier, ...cap];

  for (const [key, aliases] of Object.entries(CAPABILITY_PLUGIN_CANDIDATES)) {
    if (aliases.includes(identifier)) return [key, ...aliases];
  }
  return [identifier];
};

/**
 * Installed workspace plugin ids that match a DAG/capability identifier.
 * Empty ⇒ plugin not installed in this workspace (skip; never fall back to global).
 */
export const installedAliasesFor = (identifier: string, pluginIds: string[]): string[] => {
  const installed = new Set(pluginIds);
  return [...new Set(aliasGroupFor(identifier))].filter((id) => installed.has(id));
};

/**
 * Rewrite mode.toolApis identifiers onto this run's installed pluginIds.
 * Drops steps whose capability is not installed (optional plugins).
 */
export const rewriteToolApisToInstalled = (
  toolApis: OperationsToolApiRef[],
  pluginIds: string[],
): OperationsToolApiRef[] => {
  const out: OperationsToolApiRef[] = [];
  for (const ref of toolApis) {
    if (ref.identifier === 'lobe-agent-documents') {
      out.push(ref);
      continue;
    }
    const installed = installedAliasesFor(ref.identifier, pluginIds);
    if (!installed.length) continue;
    const id = installed.includes(ref.identifier) ? ref.identifier : installed[0]!;
    out.push({ ...ref, identifier: id });
  }
  return out;
};
