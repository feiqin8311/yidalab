/**
 * Platform context / tool-result contracts.
 * Large data lives in artifacts; model/UI/logs get bounded projections.
 */

// ---------------------------------------------------------------------------
// Trust & memory (external data must not auto-pollute long-term memory)
// ---------------------------------------------------------------------------

export type ContextTrustLevel = 'user' | 'system' | 'external';

/** How derived memory may use this content. */
export type ContextMemoryPolicy = 'allow' | 'deny' | 'summary_only';

export interface ContextTrustMeta {
  memoryPolicy: ContextMemoryPolicy;
  /** Cell/web/MCP bodies are external and untrusted as instructions. */
  trustLevel: ContextTrustLevel;
}

// ---------------------------------------------------------------------------
// Artifact (first-class platform object — not PortalArtifact UI type)
// ---------------------------------------------------------------------------

export type PlatformArtifactKind =
  'file' | 'table' | 'query_result' | 'report' | 'log' | 'workbook_sheet';

export interface PlatformArtifactRef {
  contentHash?: string;
  expiresAt?: string;
  id: string;
  kind: PlatformArtifactKind;
  mimeType: string;
  ownerId: string;
  size: number;
  workspaceId?: string;
}

// ---------------------------------------------------------------------------
// Query / tool provenance
// ---------------------------------------------------------------------------

export interface ToolResultSource {
  fileId?: string;
  fileVersion?: string;
  queryHash?: string;
  sheet?: string;
  tool?: string;
}

export interface ToolResultCoverage {
  matchedRows?: number;
  returnedRows: number;
  scannedRows?: number;
  totalRows?: number;
}

// ---------------------------------------------------------------------------
// Four views of one tool execution (never one string for all consumers)
// ---------------------------------------------------------------------------

export interface ModelToolResultView {
  /** Strictly capped text/JSON for the model context. */
  content: string;
  coverage?: ToolResultCoverage;
  nextCursor?: string;
  source?: ToolResultSource;
  truncated?: boolean;
  trust: ContextTrustMeta;
}

export interface UIToolResultView {
  downloadUrl?: string;
  nextCursor?: string;
  /** Optional preview rows (bounded). */
  preview?: unknown;
  /** Short summary for cards / inspectors. */
  summary: string;
  truncated?: boolean;
}

export interface TelemetryToolResultView {
  durationMs?: number;
  errorCode?: string;
  /** Redacted, size-capped log line. */
  preview: string;
  success: boolean;
}

/**
 * Split tool output: model / UI / storage / logs must not share one mega string.
 */
export interface ToolExecutionResult {
  artifact?: PlatformArtifactRef;
  /** Back-compat: same as modelView.content for existing executors. */
  content?: string;
  error?: { message: string; type?: string };
  modelView: ModelToolResultView;
  state?: unknown;
  success: boolean;
  telemetryView: TelemetryToolResultView;
  uiView: UIToolResultView;
}

// ---------------------------------------------------------------------------
// Strongly typed context items (no free-form string assembly in business code)
// ---------------------------------------------------------------------------

export type ContextItemKind =
  'system' | 'history' | 'file_manifest' | 'tool_result' | 'memory' | 'skill' | 'runtime_state';

export interface ContextItemBudget {
  estimatedTokens: number;
  hardLimit: number;
  priority: number;
}

export interface ContextItemBase extends ContextItemBudget, Partial<ContextTrustMeta> {
  cacheKey?: string;
  id: string;
  kind: ContextItemKind;
  sourceRef?: string;
}

export interface ContextItem extends ContextItemBase {
  /** Produce model-facing text within the remaining token budget. */
  render: (tokenBudget: number) => string;
}

// ---------------------------------------------------------------------------
// Context trace (replay why the model saw what it saw)
// ---------------------------------------------------------------------------

export interface ContextTraceItemBudget {
  dropped?: boolean;
  id?: string;
  kind: ContextItemKind | string;
  tokens: number;
}

export interface ContextTraceSnapshot {
  compacted?: boolean;
  contextWindow: number;
  droppedItems?: ContextTraceItemBudget[];
  estimatedInputTokens: number;
  itemBudgets: ContextTraceItemBudget[];
  model?: string;
  operationId?: string;
  providerInputTokens?: number;
  stepId?: string;
  toolSchemasTokens?: number;
}

// ---------------------------------------------------------------------------
// Runtime diagnostics (isolation — one file parse fail ≠ whole session fail)
// ---------------------------------------------------------------------------

export type RuntimeDiagnosticSeverity = 'info' | 'warning' | 'error';
export type RuntimeDiagnosticSource = 'tool' | 'plugin' | 'provider' | 'file_parser' | 'context';

export interface RuntimeDiagnostic {
  code: string;
  fileId?: string;
  message: string;
  recoverable: boolean;
  severity: RuntimeDiagnosticSeverity;
  source: RuntimeDiagnosticSource;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const EXTERNAL_TRUST: ContextTrustMeta = {
  memoryPolicy: 'deny',
  trustLevel: 'external',
};

export const USER_TRUST: ContextTrustMeta = {
  memoryPolicy: 'allow',
  trustLevel: 'user',
};

export const SYSTEM_TRUST: ContextTrustMeta = {
  memoryPolicy: 'deny',
  trustLevel: 'system',
};

/** Rough token estimate (~4 chars / token). */
export const approxTokensFromText = (text: string): number => Math.ceil((text?.length ?? 0) / 4);
