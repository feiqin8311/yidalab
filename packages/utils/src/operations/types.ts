import type { z } from 'zod';

/** Capability identifiers used by preflight + executor whitelist. */
export type OperationsCapabilityId =
  | 'company.mcp.sif-mcp'
  | 'company.mcp.lingxing-mcp'
  | 'company.mcp.sellersprite-mcp'
  | 'company.mcp.sorftime-mcp'
  | 'skill.amazon-listing-intent-auditor'
  | 'skill.listing-rufus-auditor'
  | 'skill.user-pain-miner'
  | 'skill.competitor-analyzer'
  | 'skill.competitor-visual-analyzer'
  | 'skill.dtc-market-research'
  | 'amazon.product'
  | 'amazon.reviews'
  | 'web.search'
  | 'model.tools'
  | 'model.vision';

export type OperationsFieldType =
  | 'marketplace'
  | 'asin'
  | 'asinList'
  | 'text'
  | 'textarea'
  | 'keywordList'
  | 'date'
  | 'dateRange'
  | 'number'
  | 'select';

export type OperationsFieldDef = {
  defaultValue?: unknown;
  description?: string;
  /** When true, field is hidden unless advanced toggle is on. */
  advanced?: boolean;
  key: string;
  label: string;
  max?: number;
  maxItems?: number;
  min?: number;
  options?: Array<{ label: string; labelKey?: string; value: string }>;
  placeholder?: string;
  /** i18n key suffix under businessFunctions.ops.placeholder.* */
  placeholderKey?: string;
  required?: boolean;
  /** Lock value (e.g. US marketplace for DTC). */
  lockedValue?: string;
  type: OperationsFieldType;
};

export type OperationsCapabilityRequirement = {
  /** All of these must be available. */
  required?: OperationsCapabilityId[];
  /** At least one group must be fully available (OR of ANDs). */
  anyOfGroups?: OperationsCapabilityId[][];
  /** Optional: missing → degrade, still run. */
  optional?: OperationsCapabilityId[];
};

export type OperationsModeDef = {
  capabilities: OperationsCapabilityRequirement;
  description: string;
  fields: OperationsFieldDef[];
  functionId: string;
  id: string;
  maxSteps: number;
  name: string;
  promptVersion: string;
  reportSections: string[];
  requiresTools: boolean;
  requiresVision?: boolean;
  /** Build the fixed operator prompt from validated params. */
  buildPrompt: (params: Record<string, unknown>) => string;
  /** Zod object schema for server createRun. */
  inputSchema: z.ZodType<Record<string, unknown>>;
};

export type OperationsFunctionDef = {
  description: string;
  id: string;
  modes: OperationsModeDef[];
  name: string;
  path: string;
};

export type OperationsCapabilityStatus = {
  available: boolean;
  id: OperationsCapabilityId;
  label: string;
  /** i18n key suffix under businessFunctions.ops.capability.* */
  labelKey?: string;
  kind: 'mcp' | 'skill' | 'data' | 'model';
  reason?: string;
};

export type OperationsPreflightResult = {
  canRun: boolean;
  degraded: OperationsCapabilityId[];
  missingRequired: OperationsCapabilityId[];
  statuses: OperationsCapabilityStatus[];
};
