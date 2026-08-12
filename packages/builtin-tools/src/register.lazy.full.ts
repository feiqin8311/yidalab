/**
 * Lazy (dynamic-import) registration of builtin tool UI surfaces.
 *
 * Core identifiers stay eager in register.ts for first-paint tool messages.
 * Everything else loads after first paint via registerLazyBuiltinToolSurfaces().
 *
 * Internal profile drops non-core packs from this map entirely so their
 * `/client` modules never enter the import graph (see vite/next alias to
 * register.lazy.internal.ts).
 */
import type {
  BuiltinInspector,
  BuiltinIntervention,
  BuiltinPlaceholder,
  BuiltinPortal,
  BuiltinPortalTitle,
  BuiltinRender,
  BuiltinStreaming,
} from '@lobechat/types';

import { registerBuiltinInspectors } from './inspectors';
import { registerBuiltinInterventions } from './interventions';
import { registerBuiltinPlaceholders } from './placeholders';
import { registerBuiltinPortals } from './portals';
import { registerBuiltinRenders } from './renders';
import { registerBuiltinStreamings } from './streamings';

type SurfacePack = {
  inspectors?: Record<string, Record<string, BuiltinInspector>>;
  interventions?: Record<string, Record<string, BuiltinIntervention>>;
  placeholders?: Record<string, Record<string, BuiltinPlaceholder>>;
  portals?: {
    actions?: Record<string, BuiltinPortalTitle>;
    portals?: Record<string, BuiltinPortal>;
    titles?: Record<string, BuiltinPortalTitle>;
  };
  renders?: Record<string, Record<string, BuiltinRender>>;
  streamings?: Record<string, Record<string, BuiltinStreaming>>;
};

type Loader = () => Promise<SurfacePack>;

/** Optional / heavy tool UIs — loaded after first paint. */
export const lazySurfaceLoaders: Record<string, Loader> = {
  'claude-code': async () => {
    const m = await import('@lobechat/builtin-tool-claude-code/client');
    return {
      inspectors: {
        [m.ClaudeCodeIdentifier]: m.ClaudeCodeInspectors as Record<string, BuiltinInspector>,
      },
      interventions: {
        [m.ClaudeCodeIdentifier]: m.ClaudeCodeInterventions as Record<string, BuiltinIntervention>,
      },
      renders: {
        [m.ClaudeCodeIdentifier]: m.ClaudeCodeRenders as Record<string, BuiltinRender>,
      },
      streamings: {
        [m.ClaudeCodeIdentifier]: m.ClaudeCodeStreamings as Record<string, BuiltinStreaming>,
      },
    };
  },
  'cloud-sandbox': async () => {
    const m = await import('@lobechat/builtin-tool-cloud-sandbox/client');
    return {
      inspectors: {
        [m.CloudSandboxManifest.identifier]: m.CloudSandboxInspectors as Record<
          string,
          BuiltinInspector
        >,
      },
      interventions: {
        [m.CloudSandboxManifest.identifier]: m.CloudSandboxInterventions as Record<
          string,
          BuiltinIntervention
        >,
      },
      renders: {
        [m.CloudSandboxManifest.identifier]: m.CloudSandboxRenders as Record<string, BuiltinRender>,
      },
      streamings: {
        [m.CloudSandboxManifest.identifier]: m.CloudSandboxStreamings as Record<
          string,
          BuiltinStreaming
        >,
      },
    };
  },
  'group-agent-builder': async () => {
    const m = await import('@lobechat/builtin-tool-group-agent-builder/client');
    return {
      inspectors: {
        [m.GroupAgentBuilderManifest.identifier]: m.GroupAgentBuilderInspectors as Record<
          string,
          BuiltinInspector
        >,
      },
      renders: {
        [m.GroupAgentBuilderManifest.identifier]: m.GroupAgentBuilderRenders as Record<
          string,
          BuiltinRender
        >,
      },
      streamings: {
        [m.GroupAgentBuilderManifest.identifier]: m.GroupAgentBuilderStreamings as Record<
          string,
          BuiltinStreaming
        >,
      },
    };
  },
  'remote-device': async () => {
    const m = await import('@lobechat/builtin-tool-remote-device/client');
    return {
      renders: {
        [m.RemoteDeviceManifest.identifier]: m.RemoteDeviceRenders as Record<string, BuiltinRender>,
      },
    };
  },
  'self-iteration': async () => {
    const m = await import('@lobechat/builtin-tool-self-iteration/client');
    return {
      inspectors: {
        [m.selfFeedbackIntentManifest.identifier]: m.SelfFeedbackIntentInspectors as Record<
          string,
          BuiltinInspector
        >,
      },
    };
  },
  'web-onboarding': async () => {
    const m = await import('@lobechat/builtin-tool-web-onboarding/client');
    return {
      inspectors: {
        [m.WebOnboardingManifest.identifier]: m.WebOnboardingInspectors as Record<
          string,
          BuiltinInspector
        >,
      },
      interventions: {
        [m.WebOnboardingManifest.identifier]: m.WebOnboardingInterventions as Record<
          string,
          BuiltinIntervention
        >,
      },
      renders: {
        [m.WebOnboardingManifest.identifier]: m.WebOnboardingRenders as Record<
          string,
          BuiltinRender
        >,
      },
    };
  },
  'codex': async () => {
    const { CodexInspectors, CodexRenders } = await import('./codex');
    const { RunCommandRender } = await import('@lobechat/shared-tool-ui/renders');
    return {
      inspectors: { codex: CodexInspectors },
      renders: {
        codex: {
          ...CodexRenders,
          command_execution: RunCommandRender as BuiltinRender,
        },
      },
    };
  },
  'github': async () => {
    const m = await import('./github');
    return {
      inspectors: { [m.GithubIdentifier]: m.GithubInspectors },
      renders: { [m.GithubIdentifier]: m.GithubRenders },
    };
  },
  'linear': async () => {
    const m = await import('./linear');
    return {
      inspectors: { [m.LinearIdentifier]: m.LinearInspectors },
      renders: { [m.LinearIdentifier]: m.LinearRenders },
    };
  },
  'notebook': async () => {
    const m = await import('./notebook');
    return {
      renders: { [m.NotebookIdentifier]: m.NotebookRenders },
    };
  },
  'twitter': async () => {
    const m = await import('./twitter');
    return {
      inspectors: { [m.TwitterIdentifier]: m.TwitterInspectors },
    };
  },
};

let lazyStarted = false;
let lazyDone: Promise<void> | undefined;

const applyPack = (pack: SurfacePack) => {
  if (pack.renders) registerBuiltinRenders(pack.renders);
  if (pack.inspectors) registerBuiltinInspectors(pack.inspectors);
  if (pack.streamings) registerBuiltinStreamings(pack.streamings);
  if (pack.interventions) registerBuiltinInterventions(pack.interventions);
  if (pack.placeholders) registerBuiltinPlaceholders(pack.placeholders);
  if (pack.portals) registerBuiltinPortals(pack.portals);
};

export const registerLazyBuiltinToolSurfaces = (): Promise<void> => {
  if (lazyDone) return lazyDone;
  if (lazyStarted) return lazyDone ?? Promise.resolve();
  lazyStarted = true;

  lazyDone = Promise.all(
    Object.entries(lazySurfaceLoaders).map(async ([id, load]) => {
      try {
        applyPack(await load());
      } catch (error) {
        console.error(`[builtin-tools] lazy surface load failed: ${id}`, error);
      }
    }),
  ).then(() => undefined);

  return lazyDone;
};
