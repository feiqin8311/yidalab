import type {
  OperationsCapabilityId,
  OperationsCapabilityStatus,
  OperationsModeDef,
  OperationsPreflightResult,
} from './types';

/** Stable i18n keys under businessFunctions.ops.capability.* */
const LABELS: Record<
  OperationsCapabilityId,
  { kind: OperationsCapabilityStatus['kind']; label: string; labelKey: string }
> = {
  'company.mcp.sif-mcp': { kind: 'mcp', label: 'SIF', labelKey: 'sif' },
  'company.mcp.lingxing-mcp': { kind: 'mcp', label: 'Lingxing', labelKey: 'lingxing' },
  'company.mcp.sellersprite-mcp': {
    kind: 'mcp',
    label: 'SellerSprite',
    labelKey: 'sellersprite',
  },
  'company.mcp.sorftime-mcp': { kind: 'mcp', label: 'Sorftime', labelKey: 'sorftime' },
  'skill.amazon-listing-intent-auditor': {
    kind: 'skill',
    label: 'Listing intent auditor',
    labelKey: 'listingIntent',
  },
  'skill.listing-rufus-auditor': {
    kind: 'skill',
    label: 'Rufus auditor',
    labelKey: 'listingRufus',
  },
  'skill.user-pain-miner': {
    kind: 'skill',
    label: 'User Pain Miner',
    labelKey: 'userPainMiner',
  },
  'skill.competitor-analyzer': {
    kind: 'skill',
    label: 'Competitor analyzer',
    labelKey: 'competitorAnalyzer',
  },
  'skill.competitor-visual-analyzer': {
    kind: 'skill',
    label: 'Competitor visual analyzer',
    labelKey: 'competitorVisual',
  },
  'skill.dtc-market-research': {
    kind: 'skill',
    label: 'DTC market research',
    labelKey: 'dtcMarket',
  },
  'amazon.product': { kind: 'data', label: 'Amazon product', labelKey: 'amazonProduct' },
  'amazon.reviews': { kind: 'data', label: 'Amazon reviews', labelKey: 'amazonReviews' },
  'web.search': { kind: 'data', label: 'Web search', labelKey: 'webSearch' },
  'model.tools': { kind: 'model', label: 'Tool-calling model', labelKey: 'modelTools' },
  'model.vision': { kind: 'model', label: 'Vision model', labelKey: 'modelVision' },
};

export type CapabilityAvailabilityMap = Partial<Record<OperationsCapabilityId, boolean>>;

export const evaluateOperationsPreflight = (
  mode: OperationsModeDef,
  available: CapabilityAvailabilityMap,
): OperationsPreflightResult => {
  const { required = [], anyOfGroups = [], optional = [] } = mode.capabilities;
  const ids = new Set<OperationsCapabilityId>([...required, ...optional, ...anyOfGroups.flat()]);

  const statuses: OperationsCapabilityStatus[] = [...ids].map((id) => {
    const meta = LABELS[id];
    const ok = available[id] === true;
    return {
      available: ok,
      id,
      kind: meta.kind,
      label: meta.label,
      labelKey: meta.labelKey,
      reason: ok ? undefined : 'not_available',
    };
  });

  const isOk = (id: OperationsCapabilityId) => available[id] === true;

  const missingRequired = required.filter((id) => !isOk(id));

  let groupOk = true;
  if (anyOfGroups.length > 0) {
    groupOk = anyOfGroups.some((group) => group.every((id) => isOk(id)));
    if (!groupOk) {
      for (const group of anyOfGroups) {
        for (const id of group) {
          if (!isOk(id) && !missingRequired.includes(id)) {
            // Represent group failure as missing first member of each group for UI
            missingRequired.push(id);
          }
        }
      }
    }
  }

  const degraded = optional.filter((id) => !isOk(id));
  const canRun = missingRequired.length === 0 && groupOk;

  // When group fails, surface distinct missing set (unique)
  const uniqueMissing = [...new Set(missingRequired)];

  return {
    canRun,
    degraded,
    missingRequired: canRun ? [] : uniqueMissing,
    statuses,
  };
};

/** MCP identifiers that map 1:1 to company.mcp.* capability ids. */
export const MCP_CAPABILITY_IDS = [
  'company.mcp.sif-mcp',
  'company.mcp.lingxing-mcp',
  'company.mcp.sellersprite-mcp',
  'company.mcp.sorftime-mcp',
] as const satisfies OperationsCapabilityId[];

export const SKILL_CAPABILITY_IDS = [
  'skill.amazon-listing-intent-auditor',
  'skill.listing-rufus-auditor',
  'skill.user-pain-miner',
  'skill.competitor-analyzer',
  'skill.competitor-visual-analyzer',
  'skill.dtc-market-research',
] as const satisfies OperationsCapabilityId[];
