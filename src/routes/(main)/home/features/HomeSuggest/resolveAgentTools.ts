import type { ToolManifest } from '@lobechat/types';

/**
 * Infrastructure / internal tools that shouldn't surface as "try this"
 * chips on the home page — even if pinned on the agent (Inbox pins
 * artifacts / docs / user-interaction by default).
 *
 * YidaLab home examples are ops scenarios or company MCP/skills —
 * not platform plumbing like Artifacts / Memory / 钉盘.
 */
const EXCLUDED_TOOL_IDS = new Set([
  // agent lifecycle / builders
  'lobe-activator',
  'lobe-agent-builder',
  'lobe-agent-documents',
  'lobe-agent-management',
  'lobe-group-agent-builder',
  'lobe-group-management',
  'lobe-skills',
  'lobe-skill-store',
  'lobe-skill-maintainer',
  'lobe-user-interaction',
  'lobe-web-onboarding',
  'lobe-page-agent',
  // deliverable / memory / notebook plumbing
  'lobe-artifacts',
  'lobe-user-memory',
  'lobe-memory',
  'lobe-notebook',
  'lobe-dingpan',
  'lobe-cloud-sandbox',
  'lobe-creds',
  'lobe-task',
  'lobe-message',
  'lobe-brief',
  'lobe-topic-reference',
  'lobe-local-system',
  'lobe-remote-device',
  'lobe-verify',
  'lobe-calculator',
  'lobe-lobe-agent',
  'lobe-delivery-checker',
  'lobe-agent-browser',
  // builtin skill ids without lobe- prefix
  'task',
  'find-skills',
  'verify',
  'lobehub',
  // agent-signal family
  'self-feedback-intent',
  'agent-signal-feedback-intent',
  'agent-signal-reflection',
  'agent-signal-review',
  'agent-signal-skill-management',
]);

export interface ResolvedToolForSuggest {
  apis: { description?: string; name: string }[];
  description: string;
  identifier: string;
  name: string;
}

/**
 * Platform tools/skills must not appear as home "try these" chips.
 * Company market (`company.*`) and third-party MCP keep showing.
 */
export const isExcludedSuggestTool = (identifier: string): boolean => {
  if (!identifier) return true;
  if (identifier.startsWith('company.')) return false;
  if (EXCLUDED_TOOL_IDS.has(identifier)) return true;
  if (identifier.startsWith('agent-signal-')) return true;
  // All remaining lobe-* are platform surface area (memory, artifacts, …)
  if (identifier.startsWith('lobe-')) return true;
  return false;
};

export interface ToolMetaSource {
  description?: string;
  identifier: string;
  name?: string;
  title?: string;
}

/**
 * Prefer agent-pinned plugins; if none are suggestable, fall back to the full
 * installed/discoverable tool list so home still reflects real MCP/skills.
 * Platform lobe-* tools are always filtered out.
 */
export const resolveToolsForHomeSuggest = ({
  agentPluginIds,
  getManifest,
  getMeta,
  installedTools,
}: {
  agentPluginIds: string[];
  getManifest: (id: string) => ToolManifest | undefined;
  getMeta: (id: string) => { description?: string; title?: string } | undefined;
  installedTools: ToolMetaSource[];
}): ResolvedToolForSuggest[] => {
  const byId = new Map<string, ResolvedToolForSuggest>();

  const upsert = (id: string, nameHint?: string, descriptionHint?: string) => {
    if (!id || isExcludedSuggestTool(id) || byId.has(id)) return;

    const meta = getMeta(id);
    const manifest = getManifest(id);
    const name = meta?.title?.trim() || nameHint?.trim() || manifest?.meta?.title?.trim() || id;
    const description =
      meta?.description?.trim() ||
      descriptionHint?.trim() ||
      manifest?.meta?.description?.trim() ||
      '';

    // Skip empty infra stubs with no human-facing description and no APIs
    const apis = (manifest?.api || [])
      .filter((api) => !!api?.name)
      .slice(0, 2)
      .map((api) => ({
        description: api.description,
        name: api.name,
      }));

    if (!description && apis.length === 0 && name === id) return;

    byId.set(id, { apis, description, identifier: id, name });
  };

  // 1) Agent-pinned plugins first (order preserved for the selected agent).
  for (const id of agentPluginIds) {
    upsert(id);
  }

  // 2) Installed / connected company MCP & third-party tools.
  for (const tool of installedTools) {
    upsert(tool.identifier, tool.name || tool.title, tool.description);
  }

  return [...byId.values()];
};

export interface BuiltSuggestPrompt {
  description: string;
  id: string;
  prompt: string;
  title: string;
}

/**
 * Build concrete prompt chips from resolved tools.
 * Prefer API-level examples when the manifest exposes them.
 */
export const buildPromptsFromTools = (
  tools: ResolvedToolForSuggest[],
  t: (key: string, opts?: Record<string, string>) => string,
  maxItems: number,
): BuiltSuggestPrompt[] => {
  const items: BuiltSuggestPrompt[] = [];

  for (const tool of tools) {
    if (items.length >= maxItems) break;

    if (tool.apis.length > 0) {
      for (const api of tool.apis) {
        if (items.length >= maxItems) break;
        const apiLabel = api.description?.trim() || api.name;
        items.push({
          description: apiLabel,
          id: `${tool.identifier}:${api.name}`,
          prompt: t('suggest.apiPrompt', {
            api: api.name,
            apiDesc: apiLabel,
            description: tool.description || apiLabel,
            name: tool.name,
          }),
          title: t('suggest.apiTitle', { api: apiLabel, name: tool.name }),
        });
      }
      continue;
    }

    items.push({
      description: tool.description || tool.name,
      id: tool.identifier,
      prompt: tool.description
        ? t('suggest.toolPromptWithDesc', {
            description: tool.description,
            name: tool.name,
          })
        : t('suggest.toolPrompt', { name: tool.name }),
      title: t('suggest.toolTitle', { name: tool.name }),
    });
  }

  return items;
};
