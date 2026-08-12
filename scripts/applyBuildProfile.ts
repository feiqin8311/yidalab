/**
 * Write thin re-export entry files for YIDALAB_BUILD_PROFILE.
 *
 * Usage:
 *   YIDALAB_BUILD_PROFILE=internal bun scripts/applyBuildProfile.ts
 *   bun scripts/applyBuildProfile.ts          # full (default)
 */
import { applyBuildProfile, resolveBuildProfile } from './buildProfileLib';

const profile = resolveBuildProfile(process.env.YIDALAB_BUILD_PROFILE);
const all = applyBuildProfile(process.cwd(), profile);
for (const e of all) {
  const reexport = profile === 'internal' ? e.internal : e.full;
  console.log(`[build-profile] ${e.entry} → ${reexport} (${profile})`);
}
console.log(`[build-profile] applied profile=${profile} (${all.length} entries)`);
