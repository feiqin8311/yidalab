/**
 * Apply YidaLab-native routing for ops skills that still ship OpenClaw wrappers.
 *
 *   bunx tsx scripts/ops-routing-seed/apply.ts
 *   bunx tsx scripts/ops-routing-seed/apply.ts --dry-run
 *
 * Updates:
 * - company_market_skills: lingxing-ads, dingtalk-fba-alert (description + content)
 * - company_market_mcps: company.mcp.lingxing-mcp (description trigger line)
 *
 * Does NOT write User Memory. Routing belongs in skill/MCP descriptions.
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
  '领星广告短查询。用户消息像「国家 + 广告活动 + SKU」（可含中文/+/建议bid）时激活；用 company.mcp.lingxing-mcp 查数，勿走 OpenClaw bash。例：美国 80981227+SBV+精准+carbide burr等+建议bid1.85 80981227';

const FBA_DESCRIPTION =
  'LIBRATON 库存预警固定口令：LIBRATON库存预警（先选站点菜单）、LIBRATON库存预警-全部/美国/加拿大/欧洲/日本。设备侧执行预警；文件分享用 lobe-dingpan。勿写 OpenClaw 默认 userId。';

const LINGXING_MCP_DESCRIPTION =
  '领星广告 MCP：按国家/活动/SKU/ASIN 查已同步广告表现。用户甩「国家 + 活动 + SKU」短串时优先用本 MCP（可先 activateTools）。工具：get_schema_summary, query_campaign_ads, query_sku_ads, query_asin_ads, query_asin_ad_architecture, query_campaign_querywords, query_negative_rules。';

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set.');
    process.exit(1);
  }

  const lingxingContent = readFileSync(join(__dirname, 'skills/lingxing-ads.md'), 'utf8');
  const fbaContent = readFileSync(join(__dirname, 'skills/dingtalk-fba-alert.md'), 'utf8');

  const { serverDB } = await import('../../packages/database/src/server');
  const { companyMarketSkills } =
    await import('../../packages/database/src/schemas/companyMarketSkill');
  const { companyMarketMcps } =
    await import('../../packages/database/src/schemas/companyMarketMcp');
  const { eq } = await import('drizzle-orm');

  const skillUpdates: Array<{ name: string; description: string; content: string }> = [
    { name: 'lingxing-ads', description: LINGXING_DESCRIPTION, content: lingxingContent },
    { name: 'dingtalk-fba-alert', description: FBA_DESCRIPTION, content: fbaContent },
  ];

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
      console.log(`→ skill ${u.name} (${row.identifier})`);
      if (dryRun) continue;
      await serverDB
        .update(companyMarketSkills)
        .set({
          content: u.content,
          description: u.description,
          updatedAt: new Date(),
        })
        .where(eq(companyMarketSkills.id, row.id));
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
