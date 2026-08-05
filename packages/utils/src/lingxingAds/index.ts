/** Public surface: pipeline + display helpers UI/Markdown share. Internals stay module-private. */
import { buildV7Markdown } from './markdown';
import { parseAnalyzeCampaignResult } from './parse';
import { buildAnalysisSections } from './rules';
import type { LingxingAnalysisOutput } from './types';

export {
  buildV7Markdown,
  formatBidRuleLines,
  formatNegativeLines,
  resolveCpoCaps,
} from './markdown';
export { parseAnalyzeCampaignResult, unwrapAnalyzePayload } from './parse';
export { buildAnalysisSections } from './rules';
export { acosDirection, computeTrendLabel, pickTrendLabel } from './trend';
export type {
  AnalysisSections,
  AnalyzeCampaignResult,
  BidRuleLine,
  CompareBlock,
  LingxingAnalysisOutput,
  MetricWindow,
  NegativeRules,
  NegativeSection,
  RecommendedSettings,
  RuleHit,
  Thresholds,
  TrendLabel,
} from './types';

const LINGXING_IDENTIFIER = 'company.mcp.lingxing-mcp';
const LINGXING_TOOL = 'analyze_campaign';

/** Pure pipeline: MCP payload → structured analysis + V7 markdown. */
export const buildLingxingAnalysis = (
  payload: unknown,
  options?: { generatedAt?: string },
): LingxingAnalysisOutput => {
  const result = parseAnalyzeCampaignResult(payload);
  const analysis = buildAnalysisSections(result);
  return {
    analysis,
    markdown: buildV7Markdown(analysis),
    source: {
      generatedAt: options?.generatedAt ?? new Date().toISOString(),
      identifier: LINGXING_IDENTIFIER,
      toolName: LINGXING_TOOL,
    },
  };
};

export const LINGXING_MCP_IDENTIFIER = LINGXING_IDENTIFIER;
export const LINGXING_ANALYZE_TOOL = LINGXING_TOOL;
