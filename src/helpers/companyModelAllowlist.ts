/**
 * Client-side filter for company member model allowlists.
 * Mirrors server `isModelAllowed` (packages/database/.../companyMemberQuota).
 */

export interface AllowedModelRef {
  model: string;
  provider: string;
}

export const modelKey = (provider: string, model: string) =>
  `${provider.trim().toLowerCase()}::${model.trim()}`;

/** null/undefined = unrestricted; [] = none; otherwise only listed pairs. */
export const isModelAllowed = (
  allowedModels: AllowedModelRef[] | null | undefined,
  provider: string,
  model: string,
): boolean => {
  if (allowedModels === null || allowedModels === undefined) return true;
  if (allowedModels.length === 0) return false;
  const key = modelKey(provider, model);
  return allowedModels.some((item) => modelKey(item.provider, item.model) === key);
};

export interface ProviderWithModels {
  [key: string]: unknown;
  children: Array<{ id: string; [key: string]: unknown }>;
  id: string;
}

/**
 * Drop models (and empty providers) not on the allowlist.
 * Returns the original list reference when unrestricted.
 */
export const filterProvidersByAllowlist = <T extends ProviderWithModels>(
  providers: T[],
  allowedModels: AllowedModelRef[] | null | undefined,
): T[] => {
  if (allowedModels === null || allowedModels === undefined) return providers;
  if (allowedModels.length === 0) return [];

  return providers
    .map((provider) => {
      const children = (provider.children || []).filter((model) =>
        isModelAllowed(allowedModels, provider.id, model.id),
      );
      if (children.length === 0) return null;
      return { ...provider, children };
    })
    .filter(Boolean) as T[];
};
