import {
  approxTokensFromText,
  type ContextItem,
  type ContextItemKind,
  type ContextMemoryPolicy,
  type ContextTraceItemBudget,
  type ContextTraceSnapshot,
  type ContextTrustLevel,
  EXTERNAL_TRUST,
  SYSTEM_TRUST,
  USER_TRUST,
} from '@lobechat/types';

import { evaluateContextBudgetGate } from './contextBudgetGate';

export interface CreateContextItemParams {
  cacheKey?: string;
  hardLimit?: number;
  id: string;
  kind: ContextItemKind;
  memoryPolicy?: ContextMemoryPolicy;
  priority?: number;
  sourceRef?: string;
  /** Full body; render() will slice to budget. */
  text: string;
  trustLevel?: ContextTrustLevel;
}

const trustFor = (level: ContextTrustLevel = 'system') => {
  if (level === 'external') return EXTERNAL_TRUST;
  if (level === 'user') return USER_TRUST;
  return SYSTEM_TRUST;
};

/**
 * Strongly typed context fragment. Business code should not free-form concat
 * into the prompt — allocate items and let the assembler render under budget.
 */
export function createContextItem(params: CreateContextItemParams): ContextItem {
  const trust = trustFor(params.trustLevel);
  const estimatedTokens = approxTokensFromText(params.text);
  const hardLimit = params.hardLimit ?? estimatedTokens;
  const priority = params.priority ?? 50;

  return {
    cacheKey: params.cacheKey,
    estimatedTokens,
    hardLimit,
    id: params.id,
    kind: params.kind,
    memoryPolicy: params.memoryPolicy ?? trust.memoryPolicy,
    priority,
    sourceRef: params.sourceRef,
    trustLevel: params.trustLevel ?? trust.trustLevel,
    render: (tokenBudget: number) => {
      const maxChars = Math.max(0, Math.min(hardLimit, tokenBudget) * 4);
      if (params.text.length <= maxChars) return params.text;
      return `${params.text.slice(0, maxChars)}\n…[context item ${params.id} truncated]`;
    },
  };
}

export function createFileManifestContextItem(params: {
  fileId: string;
  card: string;
  hardLimit?: number;
}): ContextItem {
  return createContextItem({
    hardLimit: params.hardLimit ?? 4_000,
    id: `file_manifest:${params.fileId}`,
    kind: 'file_manifest',
    priority: 40,
    sourceRef: params.fileId,
    text: params.card,
    trustLevel: 'external',
    memoryPolicy: 'deny',
  });
}

export interface AssembleContextItemsResult {
  dropped: ContextTraceItemBudget[];
  itemBudgets: ContextTraceItemBudget[];
  text: string;
  totalTokens: number;
}

/**
 * Priority-descending pack of context items under a token budget.
 */
export function assembleContextItems(
  items: ContextItem[],
  totalTokenBudget: number,
): AssembleContextItemsResult {
  const sorted = [...items].sort((a, b) => b.priority - a.priority);
  let remaining = totalTokenBudget;
  const parts: string[] = [];
  const itemBudgets: ContextTraceItemBudget[] = [];
  const dropped: ContextTraceItemBudget[] = [];

  for (const item of sorted) {
    if (remaining <= 0) {
      dropped.push({
        dropped: true,
        id: item.id,
        kind: item.kind,
        tokens: item.estimatedTokens,
      });
      continue;
    }
    const sliceBudget = Math.min(remaining, item.hardLimit);
    const rendered = item.render(sliceBudget);
    const used = approxTokensFromText(rendered);
    parts.push(rendered);
    itemBudgets.push({ id: item.id, kind: item.kind, tokens: used });
    remaining -= used;
  }

  const text = parts.join('\n\n');
  return {
    dropped,
    itemBudgets,
    text,
    totalTokens: approxTokensFromText(text),
  };
}

export function buildContextTraceSnapshot(params: {
  assembled: AssembleContextItemsResult;
  compacted?: boolean;
  contextWindow: number;
  model?: string;
  operationId?: string;
  providerInputTokens?: number;
  stepId?: string;
  toolSchemasTokens?: number;
}): ContextTraceSnapshot {
  const gate = evaluateContextBudgetGate({
    estimatedTokens: params.assembled.totalTokens + (params.toolSchemasTokens ?? 0),
    maxTokens: params.contextWindow,
  });

  return {
    compacted: params.compacted,
    contextWindow: params.contextWindow,
    droppedItems: params.assembled.dropped,
    estimatedInputTokens: params.assembled.totalTokens + (params.toolSchemasTokens ?? 0),
    itemBudgets: params.assembled.itemBudgets,
    model: params.model,
    operationId: params.operationId,
    providerInputTokens: params.providerInputTokens,
    stepId: params.stepId,
    toolSchemasTokens: params.toolSchemasTokens,
    // surface gate decision in dropped when reject (lightweight)
    ...(gate.action === 'reject'
      ? {
          droppedItems: [
            ...params.assembled.dropped,
            { dropped: true, kind: 'history', tokens: 0, id: 'gate:reject' },
          ],
        }
      : {}),
  };
}
