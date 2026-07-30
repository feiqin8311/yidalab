/**
 * Apply YidaLab-native routing for ops skills that still ship OpenClaw wrappers.
 *
 *   bunx tsx scripts/ops-routing-seed/apply.ts
 *   bunx tsx scripts/ops-routing-seed/apply.ts --dry-run
 *
 * Updates:
 * - company_market_skills: lingxing-ads, dingtalk-fba-alert, amazon-ops (description + content)
 * - company_market_mcps: company.mcp.lingxing-mcp (description trigger line)
 *
 * Does NOT write User Memory. Routing belongs in skill/MCP descriptions.
 * `amazon-ops` is update-only: create the company market skill once in UI if missing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

const env = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config());
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` }));
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` }));

const __dirname = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');

const LINGXING_DESCRIPTION =
  '领星广告短查询。用户像「国家+活动+SKU」时：activateTools(company.mcp.lingxing-mcp) 后直接 query_*，禁止 readReference/OpenClaw。例：美国 916341大词广泛-TOSROS 916341';

const FBA_DESCRIPTION =
  '库存预警固定口令：LIBRATON库存预警 / EZARC库存预警 / YPLUS库存预警。收到即执行 lobe-fba-alert.runFbaAlert（默认 upload_only：上传钉盘并返回 preview_url，不发钉钉私信）。无需选站点。禁止 runCommand/OpenClaw/广播。';

const AMAZON_OPS_DESCRIPTION =
  '亚马逊运营路由：ASIN流量诊断、类目大盘、Listing/Rufus、VOC评论、竞品七图、DTC站外调研、推广节奏、领星短查询。按意图 activate 对应 company MCP/skill（SIF/领星/SellerSprite/DTC），输出中文 HTML；交付走 Artifact 或钉盘，勿把 Artifacts/Memory 当业务能力。';

const LINGXING_MCP_DESCRIPTION =
  '领星广告 MCP（首选查数）。工具：query_campaign_ads(country 用 US/CA/UK…), query_sku_ads, query_asin_ads, query_asin_ad_architecture, query_campaign_querywords, query_negative_rules, get_schema_summary。HARD：单次日期跨度≤90天（近7/14/30 分段查，勿一次拉半年）。失败换 SKU/ASIN 路径，勿重复同一 country 报错参数。调用时必须用 activate 后的完整 MCP 工具名，禁止把 api 名当 identifier。';

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set.');
    process.exit(1);
  }

  const lingxingContent = readFileSync(join(__dirname, 'skills/lingxing-ads.md'), 'utf8');
  const fbaContent = readFileSync(join(__dirname, 'skills/dingtalk-fba-alert.md'), 'utf8');
  const amazonOpsContent = readFileSync(join(__dirname, 'skills/amazon-ops.md'), 'utf8');

  const { serverDB } = await import('../../packages/database/src/server');
  const { companyMarketSkills } =
    await import('../../packages/database/src/schemas/companyMarketSkill');
  const { companyMarketMcps } =
    await import('../../packages/database/src/schemas/companyMarketMcp');
  const { eq } = await import('drizzle-orm');

  const skillUpdates: Array<{
    clearResources?: boolean;
    content: string;
    description: string;
    name: string;
  }> = [
    { name: 'lingxing-ads', description: LINGXING_DESCRIPTION, content: lingxingContent },
    // HTTP-only skill: drop legacy scripts/references resource tree from market installs
    {
      name: 'dingtalk-fba-alert',
      description: FBA_DESCRIPTION,
      content: fbaContent,
      clearResources: true,
    },
    {
      name: 'amazon-ops',
      description: AMAZON_OPS_DESCRIPTION,
      content: amazonOpsContent,
      clearResources: true,
    },
  ];

  const { agentSkills } = await import('../../packages/database/src/schemas');

  for (const u of skillUpdates) {
    const rows = await serverDB
      .select({
        id: companyMarketSkills.id,
        identifier: companyMarketSkills.identifier,
        description: companyMarketSkills.description,
      })
      .from(companyMarketSkills)
      .where(eq(companyMarketSkills.name, u.name));

    if (rows.length === 0) {
      console.warn(`⚠ skill not found by name: ${u.name}`);
      continue;
    }

    for (const row of rows) {
      console.log(`→ market skill ${u.name} (${row.identifier})`);
      if (dryRun) continue;
      await serverDB
        .update(companyMarketSkills)
        .set({
          content: u.content,
          description: u.description,
          ...(u.clearResources ? { resources: {} } : {}),
          updatedAt: new Date(),
        })
        .where(eq(companyMarketSkills.id, row.id));

      // Installed copies live in agent_skills and shadow market content on activateSkill.
      const installed = await serverDB
        .update(agentSkills)
        .set({
          content: u.content,
          description: u.description,
          ...(u.clearResources ? { resources: {} } : {}),
          updatedAt: new Date(),
        })
        .where(eq(agentSkills.identifier, row.identifier))
        .returning({ id: agentSkills.id });
      console.log(
        `  → agent_skills updated: ${installed.length}${u.clearResources ? ' (resources cleared)' : ''}`,
      );
    }
  }

  const mcpRows = await serverDB
    .select({
      id: companyMarketMcps.id,
      identifier: companyMarketMcps.identifier,
      description: companyMarketMcps.description,
    })
    .from(companyMarketMcps)
    .where(eq(companyMarketMcps.identifier, 'company.mcp.lingxing-mcp'));

  for (const row of mcpRows) {
    console.log(`→ mcp ${row.identifier}`);
    if (dryRun) {
      console.log(`  old: ${row.description.slice(0, 80)}...`);
      console.log(`  new: ${LINGXING_MCP_DESCRIPTION.slice(0, 80)}...`);
      continue;
    }
    await serverDB
      .update(companyMarketMcps)
      .set({
        description: LINGXING_MCP_DESCRIPTION,
        updatedAt: new Date(),
      })
      .where(eq(companyMarketMcps.id, row.id));
  }

  console.log(dryRun ? '✅ Dry-run done (no writes).' : '✅ Applied ops routing seed.');
  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
