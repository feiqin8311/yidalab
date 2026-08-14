/**
 * Compile-time YidaLab build profile.
 *
 * Set `YIDALAB_BUILD_PROFILE=internal` before vite/next build so bundlers
 * and alias hooks can drop unused SPA routes, tools, providers, and routers
 * from the import graph. Runtime feature flags alone cannot do that.
 *
 * Values:
 * - full (default): upstream LobeHub surface
 * - internal: YidaLab irreducible core
 */

export type YidaLabBuildProfile = 'full' | 'internal';

const raw =
  typeof process !== 'undefined'
    ? (process.env.YIDALAB_BUILD_PROFILE || process.env.NEXT_PUBLIC_YIDALAB_BUILD_PROFILE || '')
        .toLowerCase()
        .trim()
    : '';

export const YIDALAB_BUILD_PROFILE: YidaLabBuildProfile = raw === 'internal' ? 'internal' : 'full';

export const isInternalBuildProfile = (): boolean => YIDALAB_BUILD_PROFILE === 'internal';

/**
 * Process role for multi-replica deploys. Single-instance should keep `all`.
 * - web: HTTP only (no gateway / crons / job loops)
 * - worker: gateway + crons + loops
 * - all (default): current single-process behaviour
 */
export type YidaLabProcessRole = 'web' | 'worker' | 'all';

export const getYidaLabProcessRole = (): YidaLabProcessRole => {
  const role = (process.env.YIDALAB_PROCESS_ROLE || 'all').toLowerCase().trim();
  if (role === 'web' || role === 'worker' || role === 'all') return role;
  console.error(
    `[YidaLab] Invalid YIDALAB_PROCESS_ROLE="${role}" (expected web|worker|all). Refusing silent fallback — using "all".`,
  );
  return 'all';
};

export const shouldRunResidentWorkers = (): boolean => {
  const role = getYidaLabProcessRole();
  return role === 'all' || role === 'worker';
};

/**
 * Internal profile: providers kept in the model catalog / runtime map.
 * Keep this list short — every id still needs a card + runtime class import
 * in the internal entry modules.
 */
export const INTERNAL_MODEL_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'azure',
  'azureai',
  'deepseek',
  'moonshot',
  'qwen',
  'zhipu',
  'bedrock',
  'ollama',
  'openrouter',
  'siliconcloud',
  'volcengine',
  'minimax',
  'groq',
  'xai',
] as const;

/**
 * Internal profile: builtin tool identifiers that stay in the registry.
 * Manifests / UI / server runtimes outside this set should not enter the
 * internal import graph (via profile entry modules).
 */
export const INTERNAL_BUILTIN_TOOL_IDS = [
  'lobe-activator',
  'lobe-skills',
  'lobe-skill-store',
  'lobe-web-browsing',
  'lobe-knowledge-base',
  'lobe-user-memory',
  'lobe-local-system',
  'lobe-cloud-sandbox',
  'lobe-agent-documents',
  'lobe-task',
  'lobe-agent',
  'lobe-dingpan',
  'lobe-workbook',
  'lobe-files',
  'lobe-creds',
  'lobe-fba-alert',
  'lobe-message',
  'lobe-user-interaction',
  'lobe-topic-reference',
  'lobe-calculator',
  'lobe-group-management',
  'lobe-agent-management',
  'lobe-agent-builder',
  'lobe-page-agent',
  'lobe-delivery-checker',
  'lobe-brief',
  'lobe-verify',
] as const;

export const isInternalBuiltinToolId = (id: string): boolean =>
  (INTERNAL_BUILTIN_TOOL_IDS as readonly string[]).includes(id);
