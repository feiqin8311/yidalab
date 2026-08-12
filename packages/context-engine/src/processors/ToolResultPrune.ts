import { approxTokensFromText } from '@lobechat/types';
import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';
import { buildToolResultReceipt } from '../utils/toolResultShape';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    toolResultHistoricalTokens?: number;
    toolResultPruned?: number;
  }
}

const log = debug('context-engine:processor:ToolResultPruneProcessor');

export interface ToolResultPruneConfig {
  /** When false, processor is a no-op. Default true when maxHistoricalToolTokens set. */
  enabled?: boolean;
  /** Token budget for all historical (non-protected) tool bodies. Default 40_000. */
  maxHistoricalToolTokens?: number;
}

const DEFAULT_MAX_HISTORICAL = 40_000;

/**
 * Micro-prune historical tool result bodies for the model view only.
 * - Always protect the latest AssistantGroup + its tool results (trailing tool chain).
 * - Replace oldest oversized tool bodies with receipts when over budget.
 * - Preserves role=tool, tool_call_id, and call order.
 * - Does not mutate DB / UI source messages (clone-only).
 */
export class ToolResultPruneProcessor extends BaseProcessor {
  readonly name = 'ToolResultPruneProcessor';

  constructor(
    private config: ToolResultPruneConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const enabled = this.config.enabled ?? true;
    const budget = this.config.maxHistoricalToolTokens ?? DEFAULT_MAX_HISTORICAL;
    if (!enabled || budget <= 0) return context;

    const cloned = this.cloneContext(context);
    const messages = cloned.messages;

    // Protect trailing assistant+tools chain (from last user or start of trailing assistant group)
    const protectedIds = collectProtectedToolIds(messages);

    // Collect prunable tool messages oldest-first with token sizes
    type ToolSlot = { index: number; id: string; tokens: number; content: string };
    const slots: ToolSlot[] = [];
    let historicalTokens = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as {
        content?: string;
        id?: string;
        plugin?: { apiName?: string; identifier?: string };
        role?: string;
        tool_call_id?: string;
      };
      if (msg.role !== 'tool') continue;
      const id = msg.id || msg.tool_call_id || `idx-${i}`;
      if (protectedIds.has(id) || (msg.tool_call_id && protectedIds.has(msg.tool_call_id))) {
        continue;
      }
      const content = typeof msg.content === 'string' ? msg.content : '';
      const tokens = approxTokensFromText(content);
      slots.push({ content, id, index: i, tokens });
      historicalTokens += tokens;
    }

    if (historicalTokens <= budget) {
      cloned.metadata.toolResultPruned = 0;
      cloned.metadata.toolResultHistoricalTokens = historicalTokens;
      return cloned;
    }

    // Prune oldest first until under budget
    let pruned = 0;
    let running = historicalTokens;
    for (const slot of slots) {
      if (running <= budget) break;
      const msg = messages[slot.index] as {
        content?: string;
        plugin?: { apiName?: string; identifier?: string };
        role?: string;
        tool_call_id?: string;
        [key: string]: unknown;
      };
      const receipt = buildToolResultReceipt({
        apiName: msg.plugin?.apiName,
        identifier: msg.plugin?.identifier,
        originalTokens: slot.tokens,
        success: true,
        toolCallId: msg.tool_call_id,
      });
      const receiptTokens = approxTokensFromText(receipt);
      running -= slot.tokens - receiptTokens;
      messages[slot.index] = {
        ...msg,
        content: receipt,
        role: msg.role ?? 'tool',
      };
      pruned++;
    }

    cloned.metadata.toolResultPruned = pruned;
    cloned.metadata.toolResultHistoricalTokens = running;
    log(
      'pruned %d historical tool bodies (was ~%d tok → ~%d tok, budget %d)',
      pruned,
      historicalTokens,
      running,
      budget,
    );

    return cloned;
  }
}

/**
 * Protect only the latest assistant group (last assistant + its tool results).
 *
 * Multi-step same-user-turn trajectories:
 *   user → a1 → t1 → a2 → t2 → a3 → t3
 * only t3 (and a3's tool ids) are protected. Earlier steps fall under the
 * historical tool budget so micro-prune can actually fire on the hot path.
 */
export const collectProtectedToolIds = (messages: any[]): Set<string> => {
  const protectedIds = new Set<string>();
  if (!messages.length) return protectedIds;

  let i = messages.length - 1;
  while (i >= 0) {
    const role = messages[i]?.role;
    if (role === 'tool' || role === 'assistant') break;
    i--;
  }

  // Collect trailing tool messages until the owning assistant, then stop.
  const trailingToolIds: string[] = [];
  while (i >= 0) {
    const msg = messages[i];
    if (msg.role === 'user' || msg.role === 'compressedGroup') break;

    if (msg.role === 'tool') {
      if (msg.id) trailingToolIds.push(msg.id);
      if (msg.tool_call_id) trailingToolIds.push(msg.tool_call_id);
      i--;
      continue;
    }

    if (msg.role === 'assistant') {
      // Protect this assistant's declared tools + trailing tool msgs only
      if (Array.isArray(msg.tools)) {
        for (const t of msg.tools) {
          if (t?.id) protectedIds.add(t.id);
        }
      }
      for (const id of trailingToolIds) protectedIds.add(id);
      break;
    }

    i--;
  }

  // No assistant found — still protect pure trailing tools (edge case)
  if (protectedIds.size === 0) {
    for (const id of trailingToolIds) protectedIds.add(id);
  }

  return protectedIds;
};
