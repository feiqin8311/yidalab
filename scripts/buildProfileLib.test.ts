import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyBuildProfile,
  collectChunkSources,
  discoverBackendRouteEntries,
  entryPointsToProfile,
  listAllProfileEntries,
  parseTurbopackChunkRefs,
  type ProfileEntry,
  renderProfileEntry,
  resolveBuildProfile,
  resolveTurbopackChunk,
} from './buildProfileLib';

const tmpDirs: string[] = [];

const mkRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'));
  tmpDirs.push(root);
  return root;
};

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { force: true, recursive: true });
  }
});

describe('buildProfileLib', () => {
  it('resolves profile env', () => {
    expect(resolveBuildProfile(undefined)).toBe('full');
    expect(resolveBuildProfile('internal')).toBe('internal');
    expect(resolveBuildProfile('INTERNAL')).toBe('internal');
    expect(resolveBuildProfile('nope')).toBe('full');
  });

  it('discovers backend route.full + requires route.internal', () => {
    const root = mkRoot();
    const dir = path.join(root, 'src/app/(backend)/webapi/create-image/comfyui');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'route.full.ts'), 'export const POST = () => {}');
    expect(() => discoverBackendRouteEntries(root)).toThrow(/missing route.internal/);
    fs.writeFileSync(path.join(dir, 'route.internal.ts'), "export * from '@/stub'");
    const found = discoverBackendRouteEntries(root);
    expect(found).toHaveLength(1);
    expect(found[0]!.entry).toContain('comfyui/route.ts');
  });

  it('entryPointsToProfile requires exact renderProfileEntry body', () => {
    const entry: ProfileEntry = {
      entry: 'src/app/(backend)/x/route.ts',
      full: './route.full',
      internal: './route.internal',
    };
    const good = renderProfileEntry(entry, 'internal');
    expect(entryPointsToProfile(good, entry, 'internal')).toBe(true);
    expect(entryPointsToProfile(good, entry, 'full')).toBe(false);
    // comment-only false positive must not pass
    const fake = `export * from './index.full'; // .internal\n`;
    expect(entryPointsToProfile(fake, entry, 'internal')).toBe(false);
    expect(entryPointsToProfile(fake, entry, 'full')).toBe(false);
  });

  it('applyBuildProfile writes re-exports for discovered routes (fixture root only)', () => {
    const root = mkRoot();
    // Minimal core pairs so listAllProfileEntries + apply don't throw
    const cores: { entry: string; full: string; internal: string; kind?: 'ts' | 'tsx' }[] = [
      {
        entry: 'packages/builtin-tools/src/index.ts',
        full: 'index.full.ts',
        internal: 'index.internal.ts',
      },
      {
        entry: 'packages/builtin-tools/src/register.lazy.ts',
        full: 'register.lazy.full.ts',
        internal: 'register.lazy.internal.ts',
      },
      {
        entry: 'packages/model-bank/src/modelProviders/index.ts',
        full: 'index.full.ts',
        internal: 'index.internal.ts',
      },
      {
        entry: 'packages/model-runtime/src/runtimeMap.ts',
        full: 'runtimeMap.full.ts',
        internal: 'runtimeMap.internal.ts',
      },
      {
        entry: 'apps/server/src/services/toolExecution/serverRuntimes/index.ts',
        full: 'index.full.ts',
        internal: 'index.internal.ts',
      },
      {
        entry: 'apps/server/src/routers/lambda/index.ts',
        full: 'index.full.ts',
        internal: 'index.internal.ts',
      },
      {
        entry: 'apps/server/src/routers/lambda/market/index.ts',
        full: 'index.full.ts',
        internal: 'index.internal.ts',
      },
      {
        entry: 'src/store/tool/slices/builtin/executors/index.ts',
        full: 'index.full.ts',
        internal: 'index.internal.ts',
      },
      {
        entry: 'src/spa/router/desktopRouter.config.tsx',
        full: 'desktopRouter.config.full.tsx',
        internal: 'desktopRouter.config.internal.tsx',
        kind: 'tsx',
      },
      {
        entry: 'src/spa/router/desktopRouter.config.desktop.tsx',
        full: 'desktopRouter.config.desktop.full.tsx',
        internal: 'desktopRouter.config.desktop.internal.tsx',
        kind: 'tsx',
      },
    ];
    for (const c of cores) {
      const dir = path.join(root, path.dirname(c.entry));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, c.full), 'export const x = 1');
      fs.writeFileSync(path.join(dir, c.internal), 'export const x = 2');
    }
    const dir = path.join(root, 'src/app/(backend)/api/webhooks/video/[provider]');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'route.full.ts'), 'export const POST = 1');
    fs.writeFileSync(path.join(dir, 'route.internal.ts'), 'export const POST = 2');

    applyBuildProfile(root, 'internal');
    const routeEntry = path.join(dir, 'route.ts');
    const body = fs.readFileSync(routeEntry, 'utf8');
    const meta = discoverBackendRouteEntries(root)[0]!;
    expect(entryPointsToProfile(body, meta, 'internal')).toBe(true);

    applyBuildProfile(root, 'full');
    expect(entryPointsToProfile(fs.readFileSync(routeEntry, 'utf8'), meta, 'full')).toBe(true);
  });

  it('parseTurbopackChunkRefs extracts R.c paths', () => {
    const src = `
var R=require("x")
R.c("server/chunks/a.js")
R.c('server/chunks/b.js')
R.m(1)
`;
    expect(parseTurbopackChunkRefs(src)).toEqual(['server/chunks/a.js', 'server/chunks/b.js']);
  });

  it('resolveTurbopackChunk uses .next base (not .next/server/server)', () => {
    const root = mkRoot();
    const chunkRel = 'server/chunks/route_actions_x.js';
    const abs = path.join(root, '.next', chunkRel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'module.exports=[]');
    const routeJs = path.join(
      root,
      '.next/server/app/(backend)/webapi/create-image/comfyui/route.js',
    );
    fs.mkdirSync(path.dirname(routeJs), { recursive: true });
    fs.writeFileSync(routeJs, `R.c("${chunkRel}")\n`);

    expect(resolveTurbopackChunk(root, chunkRel, routeJs)).toBe(abs);
    // old bug path must not be required
    expect(fs.existsSync(path.join(root, '.next/server', chunkRel))).toBe(false);
  });

  it('collectChunkSources fails open on missing refs and joins resolved bodies', () => {
    const root = mkRoot();
    const chunkRel = 'server/chunks/stub.js';
    const chunkAbs = path.join(root, '.next', chunkRel);
    fs.mkdirSync(path.dirname(chunkAbs), { recursive: true });
    fs.writeFileSync(chunkAbs, 'Not available in this deployment profile');
    const routeJs = path.join(root, '.next/server/app/(backend)/x/route.js');
    fs.mkdirSync(path.dirname(routeJs), { recursive: true });
    fs.writeFileSync(routeJs, `R.c("${chunkRel}")\nR.c("server/chunks/missing.js")\n`);

    const col = collectChunkSources(root, routeJs);
    expect(col.refs).toHaveLength(2);
    expect(col.missingRefs).toEqual(['server/chunks/missing.js']);
    expect(col.resolvedPaths).toEqual([chunkAbs]);
    expect(col.graph).toContain('Not available in this deployment profile');
  });

  it('listAllProfileEntries includes core + backend in real repo (read-only)', () => {
    const root = process.cwd();
    const all = listAllProfileEntries(root);
    expect(all.length).toBeGreaterThanOrEqual(27);
    const backends = all.filter((e) => e.entry.includes('src/app/(backend)'));
    expect(backends.length).toBeGreaterThanOrEqual(17);
  });
});
