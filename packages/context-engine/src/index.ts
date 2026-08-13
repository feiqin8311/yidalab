// Core types and interfaces
export * from './types';

// Base classes
export { BaseFirstUserContentProvider } from './base/BaseFirstUserContentProvider';
export { BaseLastUserContentProvider } from './base/BaseLastUserContentProvider';
export { BaseProcessor } from './base/BaseProcessor';
export { BaseProvider } from './base/BaseProvider';
export { BaseSystemRoleProvider } from './base/BaseSystemRoleProvider';
export { BaseVirtualLastUserContentProvider } from './base/BaseVirtualLastUserContentProvider';

// Context Engine
export * from './engine';
export type { ContextEngineConfig } from './pipeline';
export { ContextEngine } from './pipeline';

// Context Providers
export * from './providers';

// Token accounting (compression triggers + UI breakdown)
export type {
  ContextTokenAccounting,
  CountContextTokensParams,
  InputTokenBuckets,
  MessageTokenBreakdown,
  TokenSourceType,
  ToolDefinitionTokenBreakdown,
} from './tokenAccounting';
export {
  addTokenBuckets,
  countContextTokens,
  DEFAULT_DRIFT_MULTIPLIER,
  EMPTY_TOKEN_BUCKETS,
  estimatePendingUploadTokenBuckets,
  estimateSentMessageAttachmentTokenBuckets,
  isTextLikeUploadFile,
} from './tokenAccounting';
export type { ContextBudgetGateDecision, ContextBudgetGateInput } from './utils/contextBudgetGate';
export {
  DEFAULT_CONTEXT_INPUT_BUDGET,
  DEFAULT_OUTPUT_RESERVE,
  estimateTokensFromMessages,
  estimateTokensFromText,
  evaluateContextBudgetGate,
  inputBudgetFromContextWindow,
  stripFileBodiesFromMessages,
  stripInlineFileBodiesFromText,
} from './utils/contextBudgetGate';
export type { AssembleContextItemsResult, CreateContextItemParams } from './utils/contextItems';
export {
  assembleContextItems,
  buildContextTraceSnapshot,
  createContextItem,
  createFileManifestContextItem,
} from './utils/contextItems';
export type { BuildToolExecutionResultParams } from './utils/toolExecutionResult';
export {
  buildToolExecutionResult,
  modelContentFromExecutionResult,
} from './utils/toolExecutionResult';
export type {
  CacheableToolHint,
  ToolResultCacheEntry,
  ToolResultCacheIndex,
} from './utils/toolResultCache';
export {
  buildDedupHitContent,
  buildToolCacheKey,
  canonicalJson,
  cloneToolResultCache,
  createToolResultCache,
  ensureToolResultCache,
  isSifQueryTool,
  isToolCacheable,
  lookupToolCache,
  mcpToolCacheFields,
  rebuildToolCacheFromMessages,
  resolveToolCacheHint,
  writeToolCache,
} from './utils/toolResultCache';
export type {
  ShapeToolResultForModelOutcome,
  ShapeToolResultForModelParams,
} from './utils/toolResultShape';
export {
  allocateRoundToolBudgets,
  applyRoundToolResultBudgets,
  buildToolResultReceipt,
  DEFAULT_MAX_TOOL_RESULT_TOKENS,
  DEFAULT_MAX_TOOL_ROUND_TOKENS,
  shapeStructuredJson,
  shapeToolResultForModel,
  unwrapMcpEnvelope,
} from './utils/toolResultShape';
// Processors
export type { PlaceholderValue, PlaceholderValueMap } from './processors';
export {
  buildPlaceholderGenerators,
  collectProtectedToolIds,
  formatPlaceholderValues,
  getSlicedMessages,
  GroupMessageFlattenProcessor,
  HistoryTruncateProcessor,
  InputTemplateProcessor,
  MessageCleanupProcessor,
  MessageContentProcessor,
  PlaceholderVariablesProcessor,
  renderPlaceholderTemplate,
  ToolCallProcessor,
  ToolMessageReorder,
  ToolResultPruneProcessor,
} from './processors';
