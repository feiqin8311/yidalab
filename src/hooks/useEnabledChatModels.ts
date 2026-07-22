import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { filterProvidersByAllowlist } from '@/helpers/companyModelAllowlist';
import { useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

import { useCompanyModelAllowlist } from './useCompanyModelAllowlist';

export interface UseEnabledChatModelsOptions {
  /**
   * Skip company allowlist filter (e.g. admin quota editor needs the full catalog).
   * Default: false — apply the current user's allowlist.
   */
  skipQuotaFilter?: boolean;
}

/**
 * Enabled chat providers/models for the current user, filtered by company
 * member allowlist when one is configured.
 */
export const useEnabledChatModels = (
  options?: UseEnabledChatModelsOptions,
): EnabledProviderWithModels[] => {
  const enabledChatModelList = useAiInfraStore((s) => s.enabledChatModelList, isEqual);
  const { allowedModels } = useCompanyModelAllowlist();
  const skip = options?.skipQuotaFilter === true;

  return useMemo(() => {
    const list = enabledChatModelList || [];
    if (skip) return list;
    // While allowlist is loading, show full list (avoids empty flash); once
    // loaded, filter. Server still enforces.
    if (allowedModels === undefined) return list;
    return filterProvidersByAllowlist(list, allowedModels);
  }, [allowedModels, enabledChatModelList, skip]);
};
