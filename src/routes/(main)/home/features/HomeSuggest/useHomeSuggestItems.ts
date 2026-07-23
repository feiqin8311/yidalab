'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveCompanyRecommendedExamples } from '@/const/recommendedExamples';
import { useMyCompany } from '@/features/Company/hooks';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors, toolSelectors } from '@/store/tool/selectors';

import { useResolvedHomeAgentId } from '../AgentSelect/useResolvedHomeAgentId';
import { mergeRecommendExamples } from './openingQuestionsToSuggestItems';
import { pickOpsHomeSuggests } from './opsHomeSuggests';
import { buildPromptsFromTools, resolveToolsForHomeSuggest } from './resolveAgentTools';

export interface HomeSuggestItem {
  description: string;
  id: string;
  prompt: string;
  /** company = 公司通用; opening = 本助理; ops = 内置运营; tool = company/MCP */
  source: 'company' | 'opening' | 'ops' | 'tool';
  title: string;
}

/** Align with openingQuestionsToSuggestItems — show more company ops scenarios. */
const MAX_ITEMS = 12;

interface UseHomeSuggestItemsOptions {
  /**
   * When set (e.g. agent conversation welcome), scope tools/opening Qs to this
   * agent instead of the home page selector.
   */
  agentId?: string;
}

/**
 * Home "try these" chips:
 * 1. 公司通用推荐示例 + 本助理 openingQuestions（合并去重）
 * 2. 都为空时：内置运营模板 + company/MCP 补位
 *
 * Wait for company membership to settle before showing ops fallback, so users
 * don't flash OPS_HOME_SUGGESTS then jump to company defaults.
 */
export const useHomeSuggestItems = (
  options: UseHomeSuggestItemsOptions = {},
): {
  empty: boolean;
  items: HomeSuggestItem[];
  /** True while company (and thus company examples) is still resolving. */
  loading: boolean;
  /** False when list is fully user/company-configured (order is fixed). */
  refreshable: boolean;
  refresh: () => void;
} => {
  const { t } = useTranslation('home');
  const { agentId: homeAgentId } = useResolvedHomeAgentId();
  const agentId = options.agentId ?? homeAgentId;
  useInitAgentConfig(agentId);
  useFetchInstalledPlugins();
  const { data: company, isLoading: companyLoading } = useMyCompany();

  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  useFetchAgentSkills(true);

  const agentPluginIds = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgentPluginsById(agentId)(s) : [],
  );
  const openingQuestions = useAgentStore((s) => {
    if (!agentId) return [] as string[];
    return agentSelectors.getAgentConfigById(agentId)(s)?.openingQuestions ?? [];
  });

  const companyExamples = useMemo(() => {
    // No company membership → no company-wide list (ops fallback may apply after load).
    if (!company) return [] as string[];
    return resolveCompanyRecommendedExamples(company.settings?.recommendedExamples);
  }, [company, company?.settings?.recommendedExamples]);

  const builtinTools = useToolStore((s) => s.builtinTools);
  const builtinSkills = useToolStore((s) => s.builtinSkills);
  const installedPlugins = useToolStore((s) => s.installedPlugins);
  const agentSkills = useToolStore(agentSkillsSelectors.getAgentSkills);
  const installedDiscovery = useToolStore(toolSelectors.availableToolsForDiscovery);

  const [shuffleToken, setShuffleToken] = useState(0);

  const customItems = useMemo(
    () => mergeRecommendExamples(companyExamples, openingQuestions, MAX_ITEMS),
    [companyExamples, openingQuestions],
  );

  const fallbackItems = useMemo(() => {
    // Configured list owns the grid — skip ops/tool generation.
    if (customItems.length > 0) return [] as HomeSuggestItem[];

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

    return [...toolItems, ...opsItems].slice(0, MAX_ITEMS);
  }, [
    agentPluginIds,
    agentSkills,
    builtinSkills,
    builtinTools,
    customItems.length,
    installedDiscovery,
    installedPlugins,
    shuffleToken,
    t,
  ]);

  // While company is loading, hold an empty list (UI shows skeleton) instead of
  // ops fallback — avoids flash: ops chips → company defaults.
  const loading = companyLoading;
  const items = loading ? [] : customItems.length > 0 ? customItems : fallbackItems;

  return {
    empty: !loading && items.length === 0,
    items,
    loading,
    refreshable: !loading && customItems.length === 0,
    refresh: () => setShuffleToken((n) => n + 1),
  };
};
