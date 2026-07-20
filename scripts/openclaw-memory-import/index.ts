/**
 * Import an OpenClaw Person Card into YidaLab User Memory (direct drizzle writes).
 *
 * Usage:
 *   bunx tsx scripts/openclaw-memory-import/index.ts \
 *     --card=/Users/kerden/Projects/openclaw_session/migration/cards/柯鹏翔.json
 *   bunx tsx scripts/openclaw-memory-import/index.ts --card=... --dry-run
 *   bunx tsx scripts/openclaw-memory-import/index.ts --card=... --force
 *   bunx tsx scripts/openclaw-memory-import/index.ts --card=... --email=other@x.com
 *
 * Vectors left null (BM25 still works). Tags: openclaw-migration-2026-07.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { and, eq, sql } from 'drizzle-orm';

const env = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config());
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` }));
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` }));

const SOURCE_TAG = 'openclaw-migration-2026-07';

/**
 * OpenClaw MEMORY.md User / Operating Rules / skill routes must NOT become User Memory.
 * Those belong in company skills, MCP descriptions, lobe-dingpan, or thin agent systemRole.
 */
const REJECT_MEMORY_PATTERNS: RegExp[] = [
  /upload_to_ops_dingpan/i,
  /DINGTALK_FILE/i,
  /\/home\/yida\/\.openclaw/i,
  /默认.*userId|default.*userId|钉钉\s*id/i,
  /lingxing-ads|国家\s*\+\s*广告活动|LIBRATON库存预警/i,
  /preview_url.*默认|钉盘交付默认|Default delivery/i,
  /skill\s*route|技能路由/i,
];

const isRoutingOrPlatformRule = (item: { title: string; summary: string; details?: string }) => {
  const blob = `${item.title}\n${item.summary}\n${item.details ?? ''}`;
  return REJECT_MEMORY_PATTERNS.some((re) => re.test(blob));
};

type Layer = 'identity' | 'preference' | 'experience' | 'context';

interface PersonCard {
  items: Array<{
    layer: Layer;
    title: string;
    summary: string;
    details?: string;
    tags?: string[];
    evidence?: string[];
    identity?: {
      type?: string;
      role?: string;
      relationship?: string;
      description?: string;
    };
    preference?: {
      conclusionDirectives?: string;
      suggestions?: string[];
      scorePriority?: number;
    };
    experience?: {
      situation?: string;
      action?: string;
      keyLearning?: string;
      scoreConfidence?: number;
    };
    context?: {
      description?: string;
      currentStatus?: string;
      scoreImpact?: number;
      scoreUrgency?: number;
    };
  }>;
  person: {
    displayName: string;
    dingtalkId?: string | null;
    yidalabUserId?: string | null;
    email?: string | null;
  };
  review?: { status?: string };
  version: number;
}

const parseFlag = (name: string) => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
};

const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const main = async () => {
  const cardPath = parseFlag('card');
  if (!cardPath) {
    console.error(
      'Usage: bunx tsx scripts/openclaw-memory-import/index.ts --card=/path/to/card.json [--dry-run] [--force] [--email=...]',
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set.');
    process.exit(1);
  }

  const dryRun = hasFlag('dry-run');
  const force = hasFlag('force');
  const emailOverride = parseFlag('email');

  const card = JSON.parse(readFileSync(resolve(cardPath), 'utf8')) as PersonCard;
  if (card.version !== 1) {
    console.error(`❌ Unsupported card version: ${card.version}`);
    process.exit(1);
  }
  if (card.review?.status && card.review.status !== 'approved' && !force) {
    console.error(`❌ Card review.status=${card.review.status}. Approve it or pass --force.`);
    process.exit(1);
  }

  // Schema-only imports — avoid UserMemoryModel barrel (pulls agent-templates).
  const { serverDB } = await import('../../packages/database/src/server');
  const { users } = await import('../../packages/database/src/schemas/user');
  const {
    userMemories,
    userMemoriesContexts,
    userMemoriesExperiences,
    userMemoriesIdentities,
    userMemoriesPreferences,
  } = await import('../../packages/database/src/schemas/userMemories');

  const email = emailOverride || card.person.email;
  let userId = card.person.yidalabUserId || undefined;

  if (!userId && email) {
    const rows = await serverDB
      .select({ id: users.id, email: users.email, username: users.username })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    userId = rows[0]?.id;
    if (rows[0]) console.log(`🔍 email → ${rows[0].username ?? rows[0].email} (${userId})`);
  }
  if (!userId && card.person.displayName) {
    const rows = await serverDB
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.username, card.person.displayName))
      .limit(1);
    userId = rows[0]?.id;
    if (rows[0]) console.log(`🔍 username → ${rows[0].username} (${userId})`);
  }
  if (!userId) {
    console.error(`❌ Cannot resolve user for ${card.person.displayName}`);
    process.exit(1);
  }

  const existing = await serverDB
    .select({ title: userMemories.title })
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), sql`${SOURCE_TAG} = ANY(${userMemories.tags})`));
  const existingTitles = new Set(existing.map((r) => r.title).filter(Boolean) as string[]);

  console.log(
    `📦 ${card.person.displayName} → ${userId} | items=${card.items.length} existing=${existingTitles.size} dryRun=${dryRun}`,
  );

  let created = 0;
  let skipped = 0;

  for (const item of card.items) {
    if (isRoutingOrPlatformRule(item)) {
      console.log(`  ⛔ reject routing/platform rule (use skill/MCP/dingpan): ${item.title}`);
      skipped += 1;
      continue;
    }
    if (!force && existingTitles.has(item.title)) {
      console.log(`  ↷ skip: ${item.title}`);
      skipped += 1;
      continue;
    }

    const tags = Array.from(new Set([...(item.tags ?? []), SOURCE_TAG, 'openclaw-migration']));
    const details =
      item.details ||
      (item.evidence?.length ? `证据：\n- ${item.evidence.join('\n- ')}` : item.summary);
    const metadata = {
      source: 'openclaw-migration',
      sourceTag: SOURCE_TAG,
      dingtalkId: card.person.dingtalkId ?? null,
      evidence: item.evidence ?? [],
    };
    const now = new Date();

    console.log(`  → ${item.layer}: ${item.title}`);
    if (dryRun) {
      created += 1;
      continue;
    }

    const base = {
      accessedCount: 0,
      capturedAt: now,
      details,
      lastAccessedAt: now,
      memoryCategory: 'openclaw',
      metadata,
      status: 'active',
      summary: item.summary,
      tags,
      title: item.title,
      userId,
    };

    if (item.layer === 'identity') {
      const [memory] = await serverDB
        .insert(userMemories)
        .values({ ...base, memoryLayer: 'identity', memoryType: 'people' })
        .returning({ id: userMemories.id });
      await serverDB.insert(userMemoriesIdentities).values({
        capturedAt: now,
        description: item.identity?.description || item.summary,
        metadata,
        relationship: item.identity?.relationship || 'self',
        role: item.identity?.role || card.person.displayName,
        tags,
        type: item.identity?.type || 'professional',
        userId,
        userMemoryId: memory.id,
      });
      created += 1;
      continue;
    }

    if (item.layer === 'preference') {
      const [memory] = await serverDB
        .insert(userMemories)
        .values({ ...base, memoryLayer: 'preference', memoryType: 'preference' })
        .returning({ id: userMemories.id });
      await serverDB.insert(userMemoriesPreferences).values({
        capturedAt: now,
        conclusionDirectives: item.preference?.conclusionDirectives || item.summary,
        metadata,
        scorePriority: item.preference?.scorePriority ?? 0.7,
        suggestions: item.preference?.suggestions?.join('\n') ?? null,
        tags,
        type: 'preference',
        userId,
        userMemoryId: memory.id,
      });
      created += 1;
      continue;
    }

    if (item.layer === 'experience') {
      const [memory] = await serverDB
        .insert(userMemories)
        .values({ ...base, memoryLayer: 'experience', memoryType: 'topic' })
        .returning({ id: userMemories.id });
      await serverDB.insert(userMemoriesExperiences).values({
        action: item.experience?.action ?? null,
        capturedAt: now,
        keyLearning: item.experience?.keyLearning ?? null,
        metadata,
        scoreConfidence: item.experience?.scoreConfidence ?? 0.7,
        situation: item.experience?.situation ?? null,
        tags,
        type: 'topic',
        userId,
        userMemoryId: memory.id,
      });
      created += 1;
      continue;
    }

    if (item.layer === 'context') {
      const [memory] = await serverDB
        .insert(userMemories)
        .values({ ...base, memoryLayer: 'context', memoryType: 'context' })
        .returning({ id: userMemories.id });
      await serverDB.insert(userMemoriesContexts).values({
        capturedAt: now,
        currentStatus: item.context?.currentStatus ?? 'ongoing',
        description: item.context?.description || item.summary,
        metadata,
        scoreImpact: item.context?.scoreImpact ?? null,
        scoreUrgency: item.context?.scoreUrgency ?? null,
        tags,
        title: item.title,
        type: 'context',
        userId,
        userMemoryIds: [memory.id],
      });
      created += 1;
      continue;
    }

    console.warn(`  ⚠ unknown layer: ${item.layer}`);
  }

  console.log(
    dryRun
      ? `✅ Dry-run done. wouldCreate=${created} skipped=${skipped}`
      : `✅ Import done. created=${created} skipped=${skipped}`,
  );
  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
