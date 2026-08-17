/**
 * Print build artifact sizes + internal-profile exclusion assertions.
 * Usage: YIDALAB_BUILD_PROFILE=internal bun scripts/buildMetrics.mts
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  collectChunkSources,
  CORE_PROFILE_ENTRIES,
  discoverBackendRouteEntries,
  entryPointsToProfile,
  INTERNAL_STUB_MESSAGE,
  type ProfileEntry,
  resolveCompiledRouteJs,
  ROUTE_BANNED_MARKERS,
} from './buildProfileLib';

const root = process.cwd();
const profile =
  (process.env.YIDALAB_BUILD_PROFILE || 'full').toLowerCase().trim() === 'internal'
    ? 'internal'
    : 'full';

const du = (rel: string): string => {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return 'missing';
  try {
    return execSync(`du -sh ${JSON.stringify(p)}`, { encoding: 'utf8' })
      .trim()
      .split('\t')[0];
  } catch {
    return 'n/a';
  }
};

/** Parse `du -sh` human sizes (K/M/G) into MiB. */
const parseDuToMiB = (raw: string): number | null => {
  if (!raw || raw === 'missing' || raw === 'n/a') return null;
  const m = /^([\d.]+)\s*([KMGT])?/i.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || 'B').toUpperCase();
  const mult =
    unit === 'G'
      ? 1024
      : unit === 'M'
        ? 1
        : unit === 'K'
          ? 1 / 1024
          : unit === 'T'
            ? 1024 * 1024
            : 1 / (1024 * 1024);
  return n * mult;
};

/**
 * Hard budgets (MiB). Override via env:
 *   YIDALAB_BUDGET_SPA_MIB / YIDALAB_BUDGET_STANDALONE_MIB / YIDALAB_BUDGET_STATIC_MIB
 * Set to 0 to disable a budget.
 */
const budgetMiB = (envKey: string, fallback: number): number => {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const BUDGETS: { key: string; path: string; maxMiB: number }[] = [
  {
    key: 'public/_spa',
    maxMiB: budgetMiB('YIDALAB_BUDGET_SPA_MIB', profile === 'internal' ? 80 : 120),
    path: 'public/_spa',
  },
  {
    key: '.next/standalone',
    // Next standalone output varies slightly across runner images. Keep a
    // meaningful internal-profile ceiling without failing on a 1 MiB swing.
    maxMiB: budgetMiB('YIDALAB_BUDGET_STANDALONE_MIB', profile === 'internal' ? 950 : 1400),
    path: '.next/standalone',
  },
  {
    key: '.next/static',
    maxMiB: budgetMiB('YIDALAB_BUDGET_STATIC_MIB', profile === 'internal' ? 120 : 200),
    path: '.next/static',
  },
];

const rows: [string, string][] = [
  ['profile', profile],
  ['dist/desktop', du('dist/desktop')],
  ['dist/mobile', du('dist/mobile')],
  ['dist/auth', du('dist/auth')],
  ['public/_spa', du('public/_spa')],
  ['public/_spa-auth', du('public/_spa-auth')],
  ['.next/standalone', du('.next/standalone')],
  ['.next/static', du('.next/static')],
];

console.log('\n=== YidaLab build metrics ===');
for (const [k, v] of rows) {
  console.log(`${k.padEnd(20)} ${v}`);
}

let failed = false;
const fail = (msg: string) => {
  console.error(`ASSERT FAIL: ${msg}`);
  failed = true;
};
const ok = (msg: string) => console.log(`assert ok: ${msg}`);

// Hard size budgets (skip when artifact missing — pre-build metrics run)
for (const b of BUDGETS) {
  if (b.maxMiB <= 0) {
    ok(`budget disabled: ${b.key}`);
    continue;
  }
  const raw = du(b.path);
  const mib = parseDuToMiB(raw);
  if (mib === null) {
    ok(`budget skip (missing): ${b.key}`);
    continue;
  }
  if (mib > b.maxMiB) {
    fail(`${b.key} ${raw} (~${mib.toFixed(1)} MiB) exceeds budget ${b.maxMiB} MiB`);
  } else {
    ok(`budget ${b.key}: ${raw} ≤ ${b.maxMiB} MiB`);
  }
}

const assertEntry = (e: ProfileEntry, expected: 'internal' | 'full') => {
  const body = fs.readFileSync(path.join(root, e.entry), 'utf8');
  if (!entryPointsToProfile(body, e, expected)) {
    fail(`entry not on ${expected}: ${e.entry}`);
  } else {
    ok(`entry → ${expected}: ${e.entry}`);
  }
};

// NFT / standalone must not ship Vite SPA source trees
for (const dead of ['dist/desktop', 'dist/mobile', 'dist/auth']) {
  const p = path.join(root, '.next/standalone', dead);
  if (fs.existsSync(p)) fail(`${dead} present under .next/standalone`);
  else ok(`no standalone/${dead}`);
}

if (profile === 'internal') {
  // 1) Every core generated entry points at *.internal
  for (const e of CORE_PROFILE_ENTRIES) {
    assertEntry(e, 'internal');
  }

  // 2) Every profiled backend route.ts → route.internal (all 17+)
  const backendRoutes = discoverBackendRouteEntries(root);
  if (backendRoutes.length < 17) {
    fail(`expected ≥17 profiled backend routes, found ${backendRoutes.length}`);
  } else {
    ok(`discovered ${backendRoutes.length} profiled backend routes`);
  }

  for (const e of backendRoutes) {
    assertEntry(e, 'internal');

    // Compiled graph: follow turbopack R.c() chunks from route.js
    const compiled = resolveCompiledRouteJs(root, e.entry);
    if (!compiled) {
      // Build may not materialize every optional path; fail only if next output exists
      if (fs.existsSync(path.join(root, '.next/server'))) {
        fail(`compiled route.js missing for ${e.entry}`);
      }
      continue;
    }

    const { graph, refs, missingRefs, resolvedPaths } = collectChunkSources(root, compiled);
    if (refs.length === 0) {
      fail(`compiled ${e.entry} has no R.c() chunk refs`);
      continue;
    }
    if (missingRefs.length > 0) {
      fail(
        `compiled ${e.entry}: unresolved R.c() chunks (${missingRefs.length}/${refs.length}): ${missingRefs.slice(0, 3).join(', ')}`,
      );
      continue;
    }
    ok(`resolved ${resolvedPaths.length} chunks for ${path.basename(path.dirname(e.entry))}`);

    if (!graph.includes(INTERNAL_STUB_MESSAGE)) {
      fail(`compiled graph for ${e.entry} missing stub message`);
    } else {
      ok(`compiled stub message present: ${path.basename(path.dirname(e.entry))}`);
    }

    for (const rule of ROUTE_BANNED_MARKERS) {
      if (!rule.match.test(e.entry)) continue;
      for (const banned of rule.banned) {
        if (graph.includes(banned)) {
          fail(`compiled ${e.entry} still contains "${banned}"`);
        }
      }
    }
  }

  // 3) SPA internal router paths
  const spaInternal = path.join(root, 'src/spa/router/desktopRouter.config.internal.tsx');
  const spaEntryMeta = CORE_PROFILE_ENTRIES.find((e) =>
    e.entry.endsWith('desktopRouter.config.tsx'),
  )!;
  assertEntry(spaEntryMeta, 'internal');
  const spa = fs.readFileSync(spaInternal, 'utf8');
  if (!spa.includes(`path: 'community'`)) fail(`SPA internal missing path 'community'`);
  else ok(`SPA internal has path 'community'`);
  for (const banned of ['image', 'video', 'eval', 'fleet', 'billing'] as const) {
    if (spa.includes(`path: '${banned}'`)) fail(`SPA internal still has path '${banned}'`);
    else ok(`SPA internal no path '${banned}'`);
  }

  // 4) Lambda internal registry
  const lambdaEntryMeta = CORE_PROFILE_ENTRIES.find((e) =>
    e.entry.endsWith('routers/lambda/index.ts'),
  )!;
  assertEntry(lambdaEntryMeta, 'internal');
  const lambdaSrc = fs.readFileSync(
    path.join(root, 'apps/server/src/routers/lambda/index.internal.ts'),
    'utf8',
  );
  for (const banned of ['comfyui:', 'agentEval:', 'video:', 'generation:', 'klavis:'] as const) {
    if (lambdaSrc.includes(banned)) fail(`lambda.internal still registers ${banned}`);
    else ok(`lambda.internal no ${banned}`);
  }
  if (!lambdaSrc.includes('device:')) fail('lambda.internal missing device:');
  else ok('lambda.internal has device:');

  // 5) standalone heavy symbols
  const standalone = path.join(root, '.next/standalone');
  if (fs.existsSync(standalone)) {
    for (const snip of ['subscriptionRouter', 'agentEvalRouter'] as const) {
      try {
        const out = execSync(
          `rg -l --max-count 1 ${JSON.stringify(snip)} ${JSON.stringify(standalone)} 2>/dev/null || true`,
          { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
        ).trim();
        if (out) fail(`found "${snip}" in standalone:\n${out.split('\n').slice(0, 3).join('\n')}`);
        else ok(`no "${snip}" in standalone`);
      } catch {
        ok(`search skip for ${snip}`);
      }
    }
  }
}

console.log('=============================\n');
if (failed) process.exit(1);
