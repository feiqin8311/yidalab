import type { BuiltinManifestResolver, BuiltinToolResolveContext } from '@lobechat/types';

import { SkillsManifest } from './manifest';
import { SkillsApiName } from './types';

/**
 * The exec-class APIs. Their runtime target follows the run's execution plan
 * (`apps/server/.../serverRuntimes/skills.ts`): a routed device
 * (`executionEnv: 'device'`) runs `execScript` ON the device; every other
 * environment runs in the server-side cloud sandbox. Descriptions are resolved
 * per plan below so the model is never told a location the runtime won't honor.
 */
const EXEC_API_NAMES = new Set<string>([
  SkillsApiName.execScript,
  SkillsApiName.exportFile,
  SkillsApiName.runCommand,
]);

/**
 * APIs that only work against the cloud sandbox filesystem (`/home/user/...`).
 * Hidden when a device is routed (device has its own shell) OR when cloud
 * sandbox is not available for this deployment.
 */
const SANDBOX_ONLY_API_NAMES = new Set<string>([
  SkillsApiName.exportFile,
  SkillsApiName.runCommand,
]);

/**
 * When cloud sandbox is disabled and no device is routed, hide every exec API
 * that would otherwise fall through to the sandbox (including execScript).
 */
const SANDBOX_FALLBACK_API_NAMES = new Set<string>([
  SkillsApiName.execScript,
  SkillsApiName.exportFile,
  SkillsApiName.runCommand,
]);

/**
 * Per-environment description preambles for the exec-class APIs. Descriptions
 * carry tool semantics only (where it runs, what credentials it has);
 * cross-tool arbitration lives in `EXEC_ENV_FACTS`.
 *
 * - `device`: a device is routed — `execScript` runs ON it: the skill archive
 *   is downloaded/extracted device-side and the command runs in the skill
 *   directory. LobeHub-managed credentials are deliberately NOT injected into
 *   devices (`injectCredsToSandbox` only targets the sandbox).
 * - `device-unrouted`: the user chose local-device execution but no device is
 *   routed this run — the model must disclose that instead of silently
 *   running machine-specific commands in the sandbox. Wording varies by
 *   unrouted reason (see `resolveUnroutedTexts`).
 * - `sandbox`: explicit sandbox target — current semantics, just made
 *   unambiguous that it is not the user's machine.
 *
 * `local` / `none` (and no context) keep the static manifest untouched when
 * sandbox is available.
 */
const EXEC_ENV_PREAMBLES: Partial<
  Record<NonNullable<BuiltinToolResolveContext['executionEnv']>, string>
> = {
  'device':
    "Execution environment: the user's selected device, not a cloud sandbox. The skill archive is auto-extracted on the device and the command runs in the skill directory. LobeHub-managed credentials (e.g. `GITHUB_TOKEN`) are NOT injected.",
  'device-unrouted':
    'Fallback execution environment: an isolated cloud sandbox. The user chose local-device execution but no device is routed this run — say so before running commands that assume their machine.',
  'sandbox': "Execution environment: an isolated cloud sandbox, not the user's machine.",
};

/**
 * Environment facts appended to the tool systemRole. Cross-tool arbitration
 * (which runCommand to default to) belongs here, not in the API descriptions:
 * descriptions get skimmed once the tool list is long, and a "prefer the
 * other tool" rule written on the tool NOT to pick is read too late — only
 * when the model is already considering it.
 */
const EXEC_ENV_FACTS: Partial<
  Record<NonNullable<BuiltinToolResolveContext['executionEnv']>, string>
> = {
  'device':
    'A local device is routed: `execScript` runs skill scripts on the device (archive auto-extracted, cwd = skill directory); use `lobe-local-system` runCommand for other shell commands. LobeHub-managed credentials are not available on the device.',
  'device-unrouted':
    'No local device is routed; shell commands execute in the cloud sandbox this run.',
};

const NO_SANDBOX_FACT =
  'Cloud sandbox is unavailable in this deployment. Do not use runCommand/exportFile/writeFile under `/home/user`. For interactive HTML/SVG/React deliverables, use the Artifacts skill (`lobe-artifacts` / `<lobeArtifact>`). For shell work, select an online execution device first.';

/**
 * `device-unrouted` covers four reasons (`ExecutionPlanUnroutedReason`) that
 * split into two truths: the device the user counts on is OFFLINE
 * (`bound-device-offline` / `no-online-device`), vs a device is still
 * SELECTABLE (`no-bound-device` / `ambiguous-online-devices` — the
 * remote-device picker is active, so the prompt must steer toward selecting
 * one rather than declaring the device dead). Reason absent → keep the
 * neutral defaults above, which are true for all four.
 */
const resolveUnroutedTexts = (
  reason: BuiltinToolResolveContext['executionEnvUnroutedReason'],
): { fact?: string; preamble?: string } => {
  switch (reason) {
    case 'bound-device-offline':
    case 'no-online-device': {
      return {
        fact: 'Bound device offline; shell commands execute in the cloud sandbox this run.',
        preamble:
          'Fallback execution environment: an isolated cloud sandbox. The user chose their local device but it is offline — say so before running commands that assume their machine.',
      };
    }
    case 'ambiguous-online-devices':
    case 'no-bound-device': {
      return {
        fact: "No local device is selected yet (devices may be online). If the task needs the user's machine, select a device via the remote-device tool first; until then, shell commands execute in the cloud sandbox.",
        preamble:
          "Fallback execution environment: an isolated cloud sandbox. No local device is selected yet — if the task needs the user's machine, select an online device first instead of running machine-specific commands here.",
      };
    }
    default: {
      return {};
    }
  }
};

const isSandboxAvailable = (context: BuiltinToolResolveContext): boolean =>
  context.cloudSandboxAvailable !== false;

/**
 * Context-aware manifest for the lobe-skills tool: prefixes the exec-class API
 * descriptions with where they actually run, derived from the resolved
 * execution plan (see `BuiltinToolResolveContext.executionEnv`). Device runs
 * drop the sandbox-only APIs (`runCommand` / `exportFile`). When cloud sandbox
 * is disabled and no device is routed, all sandbox-bound exec APIs are hidden.
 */
export const resolveSkillsManifest: BuiltinManifestResolver = (context) => {
  const sandboxOn = isSandboxAvailable(context);
  const isDeviceRun = context.executionEnv === 'device';

  // No cloud sandbox and not on a device → strip every sandbox-bound exec API
  // so the model cannot waste turns on MARKET_AUTH_REQUIRED /home/user paths.
  if (!sandboxOn && !isDeviceRun) {
    return {
      ...SkillsManifest,
      api: SkillsManifest.api.filter((api) => !SANDBOX_FALLBACK_API_NAMES.has(api.name)),
      systemRole: `${SkillsManifest.systemRole}\n<execution_environment>\n${NO_SANDBOX_FACT}\n</execution_environment>\n`,
    };
  }

  const basePreamble = context.executionEnv && EXEC_ENV_PREAMBLES[context.executionEnv];
  if (!basePreamble) return SkillsManifest;

  // device-unrouted would advertise sandbox fallback — if sandbox is off, treat
  // like the no-sandbox branch above (already returned). Keep sandbox wording only when on.
  const unrouted =
    context.executionEnv === 'device-unrouted'
      ? resolveUnroutedTexts(context.executionEnvUnroutedReason)
      : {};
  const preamble = unrouted.preamble ?? basePreamble;
  const fact = unrouted.fact ?? (context.executionEnv && EXEC_ENV_FACTS[context.executionEnv]);

  return {
    ...SkillsManifest,
    api: SkillsManifest.api
      .filter((api) => !isDeviceRun || !SANDBOX_ONLY_API_NAMES.has(api.name))
      .map((api) =>
        EXEC_API_NAMES.has(api.name)
          ? { ...api, description: `${preamble} ${api.description}` }
          : api,
      ),
    ...(fact && {
      systemRole: `${SkillsManifest.systemRole}\n<execution_environment>\n${fact}\n</execution_environment>\n`,
    }),
  };
};
