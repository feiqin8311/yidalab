import type { OperationsCapabilityId } from './types';

/**
 * Map abstract ops capabilities → concrete plugin/skill/MCP identifiers
 * that AgentSkill / company MCP / builtin tools actually use.
 */
export const CAPABILITY_PLUGIN_CANDIDATES: Record<OperationsCapabilityId, string[]> = {
  'company.mcp.sif-mcp': ['company.mcp.sif-mcp', 'sif-mcp'],
  'company.mcp.lingxing-mcp': ['company.mcp.lingxing-mcp', 'lingxing-mcp'],
  'company.mcp.sellersprite-mcp': ['company.mcp.sellersprite-mcp', 'sellersprite-mcp'],
  'company.mcp.sorftime-mcp': ['company.mcp.sorftime-mcp', 'sorftime-mcp'],
  'skill.amazon-listing-intent-auditor': [
    'amazon-listing-intent-auditor',
    'skill.amazon-listing-intent-auditor',
  ],
  'skill.listing-rufus-auditor': ['listing-rufus-auditor', 'skill.listing-rufus-auditor'],
  'skill.user-pain-miner': ['user-pain-miner', 'skill.user-pain-miner'],
  'skill.competitor-analyzer': ['competitor-analyzer', 'skill.competitor-analyzer'],
  'skill.competitor-visual-analyzer': [
    'competitor-visual-analyzer',
    'skill.competitor-visual-analyzer',
  ],
  'skill.dtc-market-research': [
    'dtc-market-research',
    'dtc-market-research-orchestrated',
    'skill.dtc-market-research',
  ],
  'amazon.product': ['amazon-product-detail'],
  'amazon.reviews': ['amazon-reviews'],
  'web.search': ['lobe-web-browsing', 'tavily'],
  'model.tools': [],
  'model.vision': [],
};
