import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function extractPaths(source: string) {
  return [...source.matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1]).sort();
}

describe('desktopRouter internal config', () => {
  it('web and electron internal profiles drop the same heavy product paths', async () => {
    const [web, electron] = await Promise.all([
      readFile(
        path.join(process.cwd(), 'src/spa/router/desktopRouter.config.internal.tsx'),
        'utf8',
      ),
      readFile(
        path.join(process.cwd(), 'src/spa/router/desktopRouter.config.desktop.internal.tsx'),
        'utf8',
      ),
    ]);

    for (const banned of ['community', 'image', 'video', 'eval', 'fleet', 'billing'] as const) {
      expect(web.includes(`path: '${banned}'`)).toBe(false);
      expect(electron.includes(`path: '${banned}'`)).toBe(false);
    }

    // Devices stay — chat device switcher + settings need lambda.device
    expect(web.includes(`path: 'devices'`)).toBe(true);
    expect(electron.includes(`path: 'devices'`)).toBe(true);

    // Electron internal must not statically import stripped page modules
    expect(electron.includes('@/routes/(main)/(create)/image')).toBe(false);
    expect(electron.includes('@/routes/(main)/(create)/video')).toBe(false);
    expect(electron.includes('@/routes/(main)/eval')).toBe(false);
    expect(electron.includes('@/routes/(main)/fleet')).toBe(false);
  });

  it('web and electron internal share the same path set (excluding known divergences)', async () => {
    const [web, electron] = await Promise.all([
      readFile(
        path.join(process.cwd(), 'src/spa/router/desktopRouter.config.internal.tsx'),
        'utf8',
      ),
      readFile(
        path.join(process.cwd(), 'src/spa/router/desktopRouter.config.desktop.internal.tsx'),
        'utf8',
      ),
    ]);

    const webOnly = new Set([
      '/onboarding',
      '/onboarding/agent',
      '/onboarding/classic',
      '/verify',
      '/verify-im',
      ':runId',
    ]);
    const electronOnly = new Set(['/desktop-onboarding']);
    const webPaths = new Set(extractPaths(web).filter((p) => !webOnly.has(p)));
    const electronPaths = new Set(extractPaths(electron).filter((p) => !electronOnly.has(p)));

    expect([...electronPaths].sort()).toEqual([...webPaths].sort());
  });
});
