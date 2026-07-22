import type { AllowedModelRef } from '@/helpers/companyModelAllowlist';
import { useClientDataSWR } from '@/libs/swr';
import { companyService } from '@/services/company';

const MY_QUOTA_SWR_KEY = 'company:myQuota:allowlist';

/**
 * Current user's company model allowlist.
 * - `undefined` while loading (treat as unrestricted to avoid empty flash)
 * - `null` unrestricted (no company / no policy)
 * - `AllowedModelRef[]` restricted (possibly empty)
 */
export const useCompanyModelAllowlist = (): {
  allowedModels: AllowedModelRef[] | null | undefined;
  isLoading: boolean;
} => {
  const { data, isLoading } = useClientDataSWR(MY_QUOTA_SWR_KEY, async () => {
    try {
      return await companyService.getMyQuota();
    } catch {
      // Not signed in / no company API — unrestricted
      return null;
    }
  });

  if (isLoading && data === undefined) {
    return { allowedModels: undefined, isLoading: true };
  }

  // no company → open
  if (!data) return { allowedModels: null, isLoading: false };

  return { allowedModels: data.allowedModels ?? null, isLoading: false };
};

export const companyModelAllowlistSwrKey = MY_QUOTA_SWR_KEY;
