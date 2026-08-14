/**
 * Internal profile: load only the Cloud Sandbox UI pack. Other optional/heavy
 * tool surfaces stay outside the internal import graph.
 * Aliased over register.lazy.ts when YIDALAB_BUILD_PROFILE=internal.
 */
import type {
  BuiltinInspector,
  BuiltinIntervention,
  BuiltinRender,
  BuiltinStreaming,
} from '@lobechat/types';

import { registerBuiltinInspectors } from './inspectors';
import { registerBuiltinInterventions } from './interventions';
import { registerBuiltinRenders } from './renders';
import { registerBuiltinStreamings } from './streamings';

let lazyDone: Promise<void> | undefined;

export const registerLazyBuiltinToolSurfaces = (): Promise<void> => {
  if (lazyDone) return lazyDone;

  lazyDone = import('@lobechat/builtin-tool-cloud-sandbox/client').then((module) => {
    const identifier = module.CloudSandboxManifest.identifier;

    registerBuiltinInspectors({
      [identifier]: module.CloudSandboxInspectors as Record<string, BuiltinInspector>,
    });
    registerBuiltinInterventions({
      [identifier]: module.CloudSandboxInterventions as Record<string, BuiltinIntervention>,
    });
    registerBuiltinRenders({
      [identifier]: module.CloudSandboxRenders as Record<string, BuiltinRender>,
    });
    registerBuiltinStreamings({
      [identifier]: module.CloudSandboxStreamings as Record<string, BuiltinStreaming>,
    });
  });

  return lazyDone;
};
