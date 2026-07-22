'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors, toolSelectors } from '@/store/tool/selectors';

import { useResolvedHomeAgentId } from '../AgentSelect/useResolvedHomeAgentId';
import { pickOpsHomeSuggests } from './opsHomeSuggests';
import { buildPromptsFromTools, resolveToolsForHomeSuggest } from './resolveAgentTools';

export interface HomeSuggestItem {
  description: string;
  id: string;
  prompt: string;
  /** ops = 运营场景模板; tool = company/MCP; opening = agent opening Qs */
  source: 'opening' | 'ops' | 'tool';
  title: string;
}

const MAX_ITEMS = 6;

/**
 * Home "try these" chips:
 * 1. 亚马逊运营场景模板 — 始终有内容，不展示 artifacts/memory 等基建
 * 2. 已安装的 company.* / 第三方 MCP（平台 lobe-* 已在 resolve 层剔除）
 * 3. Agent openingQuestions 补位
 */
export const useHomeSuggestItems = (): {
  empty: boolean;
  items: HomeSuggestItem[];
  refresh: () => void;
} => {
  const { t } = useTranslation('home');
  const { agentId } = useResolvedHomeAgentId();
  useInitAgentConfig(agentId);
  useFetchInstalledPlugins();

  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  useFetchAgentSkills(true);

  const agentPluginIds = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgentPluginsById(agentId)(s) : [],
  );
  const openingQuestions = useAgentStore((s) => {
    if (!agentId) return [] as string[];
    return agentSelectors.getAgentConfigById(agentId)(s)?.openingQuestions ?? [];
  });

  const builtinTools = useToolStore((s) => s.builtinTools);
  const builtinSkills = useToolStore((s) => s.builtinSkills);
  const installedPlugins = useToolStore((s) => s.installedPlugins);
  const agentSkills = useToolStore(agentSkillsSelectors.getAgentSkills);
  const installedDiscovery = useToolStore(toolSelectors.availableToolsForDiscovery);

  const [shuffleToken, setShuffleToken] = useState(0);

  const items = useMemo(() => {
    const getMeta = (id: string) => {
      const builtin = builtinTools.find((tool) => tool.identifier === id);
      if (builtin) {
        return {
          description: builtin.description || builtin.manifest?.meta?.description,
          title: builtin.title || builtin.manifest?.meta?.title,
        };
      }

      const skill = builtinSkills?.find((s) => s.identifier === id);
      if (skill) {
        return { description: skill.description, title: skill.title || skill.name };
      }

      const agentSkill = agentSkills.find((s) => s.identifier === id);
      if (agentSkill) {
        return {
          description: agentSkill.description ?? agentSkill.manifest?.description,
          title: agentSkill.name,
        };
      }

      const plugin = installedPlugins.find((p) => p.identifier === id);
      if (plugin?.manifest?.meta) {
        return {
          description: plugin.manifest.meta.description,
          title: plugin.manifest.meta.title,
        };
      }

      const discovered = installedDiscovery.find((d) => d.identifier === id);
      if (discovered) {
        return { description: discovered.description, title: discovered.name };
      }

      return undefined;
    };

    const getManifest = (id: string) => {
      const builtin = builtinTools.find((tool) => tool.identifier === id);
      if (builtin?.manifest) return builtin.manifest as any;

      const plugin = installedPlugins.find((p) => p.identifier === id);
      return (plugin?.manifest as any) ?? undefined;
    };

    // Company market + third-party only (lobe-* filtered in resolveToolsForHomeSuggest).
    const installedOnly = [
      ...installedDiscovery.filter(
        (tool) => tool.identifier.startsWith('company.') || !tool.identifier.startsWith('lobe-'),
      ),
      ...agentSkills
        .filter((skill) => skill.identifier.startsWith('company.'))
        .map((skill) => ({
          description: skill.description ?? skill.manifest?.description ?? '',
          identifier: skill.identifier,
          name: skill.name,
        })),
    ];

    const tools = resolveToolsForHomeSuggest({
      agentPluginIds,
      getManifest,
      getMeta,
      installedTools: installedOnly,
    });

    const toolItems = buildPromptsFromTools(
      tools,
      (key, opts) => t(key as any, opts as any),
      // Cap company chips so curated ops scenarios still dominate the grid.
      2,
    ).map((item): HomeSuggestItem => ({
      ...item,
      source: 'tool',
    }));

    const opsItems: HomeSuggestItem[] = pickOpsHomeSuggests(
      shuffleToken,
      Math.max(0, MAX_ITEMS - toolItems.length),
    ).map((item) => ({
      description: item.description,
      id: `ops-${item.id}`,
      prompt: item.prompt,
      source: 'ops' as const,
      title: item.title,
    }));

    const used = toolItems.length + opsItems.length;
    const openingItems: HomeSuggestItem[] = openingQuestions
      .filter(Boolean)
      .slice(0, Math.max(0, MAX_ITEMS - used))
      .map((question, index) => ({
        description: question,
        id: `opening-${index}`,
        prompt: question,
        source: 'opening' as const,
        title: question,
      }));

    return [...toolItems, ...opsItems, ...openingItems].slice(0, MAX_ITEMS);
  }, [
    agentPluginIds,
    agentSkills,
    builtinSkills,
    builtinTools,
    installedDiscovery,
    installedPlugins,
    openingQuestions,
    shuffleToken,
    t,
  ]);

  return {
    empty: items.length === 0,
    items,
    refresh: () => setShuffleToken((n) => n + 1),
  };
};
