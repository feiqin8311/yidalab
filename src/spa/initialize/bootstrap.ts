import { flushSync } from 'react-dom';

import { startBootMetricsFinalize } from '@/libs/bootMetrics';
import { bootTiming } from '@/libs/bootTiming';

import { setAppReady } from '../atoms/app';
import { initializeApp } from '.';
import { startImportSettingsFromUrl } from './importSettings';
import { startPostRenderInitialization } from './postRender';
import { registerBuiltinToolSurfaces } from './toolSurfaces';

let started = false;

export const startAppInitialization = () => {
  if (started) return;
  started = true;

  const markReady = () => {
    flushSync(() => {
      setAppReady(true);
    });
    bootTiming.mark('app-ready');
  };

  try {
    // must run synchronously before first React render
    bootTiming.spanSync('import-settings', startImportSettingsFromUrl);
    bootTiming.spanSync('tool-surfaces', registerBuiltinToolSurfaces);
  } catch (error) {
    // Never leave AppLayer at appReady=false forever (white screen after splash).
    console.error('[SPA Initialize] sync bootstrap failed', error);
    markReady();
    return;
  }

  void bootTiming
    .span('core-init', initializeApp)
    .catch((error) => {
      console.error('[SPA Initialize] failed', error);
    })
    .finally(() => {
      markReady();
      startPostRenderInitialization();
      startBootMetricsFinalize();
    });
};
