import { approxTokensFromText } from '@lobechat/types';
import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    finalMessageCount?: number;
    historyTokenTruncated?: number;
    historyTruncated?: number;
  }
}

const log = debug('context-engine:processor:HistoryTruncateProcessor');

export interface HistoryTruncateConfig {
  /** Whether to enable history count limit */
  enableHistoryCount?: boolean;
  /** Maximum number of historical messages to keep */
  historyCount?: number;
  /**
   * Optional token budget for retained history (group-aware, from tail).
   * Applied after count-based slice when both are set.
   */
  maxHistoryTokens?: number;
}

/**
 * Helper interface for message with minimal required fields
 */
interface MinimalMessage {
  agentId?: string | 'supervisor';
  id: string;
  metadata?: {
    agentCouncil?: boolean;
    compare?: boolean;
    [key: string]: any;
  } | null;
  parentId?: string;
  role: string;
  tool_call_id?: string;
  tools?: Array<{ id: string; [key: string]: any }>;
}

/**
 * Build helper maps for message relationships
 */
const buildMessageMaps = (messages: MinimalMessage[]) => {
  const messageMap = new Map<string, MinimalMessage>();
  const childrenMap = new Map<string, string[]>();

  // Build messageMap
  for (const msg of messages) {
    messageMap.set(msg.id, msg);
  }

  // Build childrenMap
  for (const msg of messages) {
    if (msg.parentId) {
      const parentChildren = childrenMap.get(msg.parentId) || [];
      parentChildren.push(msg.id);
      childrenMap.set(msg.parentId, parentChildren);
    }
  }

  return { childrenMap, messageMap };
};

/**
 * Collect all message IDs in an AssistantGroup chain
 * Follows the same logic as MessageCollector.collectAssistantChain
 */
const collectAssistantGroupIds = (
  assistantId: string,
  messageMap: Map<string, MinimalMessage>,
  childrenMap: Map<string, string[]>,
  collected: Set<string>,
): void => {
  const assistant = messageMap.get(assistantId);
  if (!assistant || assistant.role !== 'assistant') return;

  // Mark assistant as collected
  collected.add(assistantId);

  // Get the agentId from the first assistant in chain
  const groupAgentId = assistant.agentId;

  // Collect tool messages
  const tools = assistant.tools || [];
  for (const tool of tools) {
    const toolId = tool.id;
    const toolMsg = messageMap.get(toolId);
    if (!toolMsg) continue;

    // Mark tool as collected
    collected.add(toolId);

    // Check if tool has agentCouncil metadata (stop here if true)
    if (toolMsg.metadata?.agentCouncil === true) continue;

    // Check if tool has multiple task children (stop here if true)
    const toolChildren = childrenMap.get(toolId) || [];
    const taskChildren = toolChildren.filter((cid) => messageMap.get(cid)?.role === 'task');
    if (taskChildren.length > 1) continue;

    // Find first child of tool message
    const firstChildId = toolChildren[0];
    if (!firstChildId) continue;

    const nextMsg = messageMap.get(firstChildId);
    if (!nextMsg) continue;

    // If next message is assistant with same agentId, recurse
    if (nextMsg.role === 'assistant' && nextMsg.agentId === groupAgentId) {
      collectAssistantGroupIds(firstChildId, messageMap, childrenMap, collected);
    }
  }
};

/**
 * Check if a message is the start of a logical group
 */
const isGroupStart = (
  msg: MinimalMessage,
  messageMap: Map<string, MinimalMessage>,
  childrenMap: Map<string, string[]>,
): boolean => {
  // AssistantGroup: assistant with tools
  if (msg.role === 'assistant' && msg.tools && msg.tools.length > 0) {
    return true;
  }

  // AgentCouncil: tool message with agentCouncil metadata
  if (msg.role === 'tool' && msg.metadata?.agentCouncil === true) {
    return true;
  }

  // Compare: message with compare metadata
  if (msg.metadata?.compare === true) {
    return true;
  }

  // Tasks: first task message in a group of multiple tasks with same parentId
  if (msg.role === 'task' && msg.parentId) {
    const siblings = childrenMap.get(msg.parentId) || [];
    const taskSiblings = siblings.filter((sid) => messageMap.get(sid)?.role === 'task');
    if (taskSiblings.length > 1 && taskSiblings[0] === msg.id) {
      return true;
    }
  }

  return false;
};

/**
 * Collect all message IDs in a logical group starting from a group-start message
 */
const collectGroupIds = (
  startId: string,
  messageMap: Map<string, MinimalMessage>,
  childrenMap: Map<string, string[]>,
): Set<string> => {
  const collected = new Set<string>();
  const startMsg = messageMap.get(startId);
  if (!startMsg) return collected;

  // AssistantGroup
  if (startMsg.role === 'assistant' && startMsg.tools && startMsg.tools.length > 0) {
    collectAssistantGroupIds(startId, messageMap, childrenMap, collected);
    return collected;
  }

  // AgentCouncil: collect tool + all its children
  if (startMsg.role === 'tool' && startMsg.metadata?.agentCouncil === true) {
    collected.add(startId);
    const children = childrenMap.get(startId) || [];
    for (const childId of children) {
      collected.add(childId);
      // Also collect their tool messages if they have any
      const child = messageMap.get(childId);
      if (child?.tools) {
        for (const tool of child.tools) {
          collected.add(tool.id);
        }
      }
    }
    return collected;
  }

  // Compare: collect message + all children
  if (startMsg.metadata?.compare === true) {
    collected.add(startId);
    const children = childrenMap.get(startId) || [];
    for (const childId of children) {
      collected.add(childId);
    }
    return collected;
  }

  // Tasks: collect all task siblings
  if (startMsg.role === 'task' && startMsg.parentId) {
    const siblings = childrenMap.get(startMsg.parentId) || [];
    const taskSiblings = siblings.filter((sid) => messageMap.get(sid)?.role === 'task');
    if (taskSiblings.length > 1) {
      // Also include parent tool message
      collected.add(startMsg.parentId);
      for (const taskId of taskSiblings) {
        collected.add(taskId);
      }
      return collected;
    }
  }

  // Not a group, just the message itself
  collected.add(startId);
  return collected;
};

/**
 * Slice messages based on history count configuration
 * Uses group-aware counting: messages grouped together in the frontend
 * (AssistantGroup, AgentCouncil, Compare, Tasks) are counted as a single unit
 *
 * @param messages Original messages array
 * @param options Configuration options for slicing
 * @returns Sliced messages array
 */
const estimateMessageTokens = (msg: any): number => {
  const content =
    typeof msg?.content === 'string' ? msg.content : JSON.stringify(msg?.content ?? '');
  const tools = Array.isArray(msg?.tools) ? JSON.stringify(msg.tools) : '';
  return approxTokensFromText(content) + approxTokensFromText(tools);
};

const buildGroups = (messages: any[]) => {
  const { messageMap, childrenMap } = buildMessageMaps(messages as MinimalMessage[]);
  const messageToGroup = new Map<string, number>();
  const groups: Set<string>[] = [];
  const processed = new Set<string>();
  let groupIndex = 0;

  for (const msg of messages as MinimalMessage[]) {
    if (processed.has(msg.id)) continue;

    if (isGroupStart(msg, messageMap, childrenMap)) {
      const groupIds = collectGroupIds(msg.id, messageMap, childrenMap);
      groups.push(groupIds);
      groupIds.forEach((id) => {
        messageToGroup.set(id, groupIndex);
        processed.add(id);
      });
      groupIndex++;
    } else {
      const singleGroup = new Set([msg.id]);
      groups.push(singleGroup);
      messageToGroup.set(msg.id, groupIndex);
      processed.add(msg.id);
      groupIndex++;
    }
  }

  return { groups, messageToGroup };
};

const collectProtectedIds = (messages: any[]): Set<string> => {
  const protectedIds = new Set<string>();
  for (const msg of messages as MinimalMessage[]) {
    if (msg.role === 'compressedGroup') protectedIds.add(msg.id);
  }
  const trailing = messages.at(-1) as MinimalMessage | undefined;
  if (trailing?.role === 'user') {
    protectedIds.add(trailing.id);
  }
  return protectedIds;
};

export const getSlicedMessages = (
  messages: any[],
  options: {
    enableHistoryCount?: boolean;
    historyCount?: number;
    maxHistoryTokens?: number;
  },
): any[] => {
  const useCount = !!options.enableHistoryCount && options.historyCount !== undefined;
  const useTokens = !!options.maxHistoryTokens && options.maxHistoryTokens > 0;

  if (!useCount && !useTokens) return messages;

  const protectedIds = collectProtectedIds(messages);

  // Count path: keep last N groups (+ anchors)
  let working = messages;
  if (useCount) {
    if (options.historyCount! <= 0) {
      working =
        protectedIds.size === 0 ? [] : messages.filter((msg: any) => protectedIds.has(msg.id));
    } else {
      const { groups, messageToGroup } = buildGroups(messages);
      const selectedGroupIndices = new Set<number>();
      for (
        let i = messages.length - 1;
        i >= 0 && selectedGroupIndices.size < options.historyCount!;
        i--
      ) {
        const msg = messages[i] as MinimalMessage;
        const groupIdx = messageToGroup.get(msg.id);
        if (groupIdx !== undefined) selectedGroupIndices.add(groupIdx);
      }
      const selectedIds = new Set<string>(protectedIds);
      for (const groupIdx of selectedGroupIndices) {
        groups[groupIdx]?.forEach((id) => selectedIds.add(id));
      }
      working = messages.filter((msg: any) => selectedIds.has(msg.id));
      log(
        `Group-aware count truncation: ${messages.length} → ${groups.length} groups → kept ${selectedGroupIndices.size} groups (${working.length} messages)`,
      );
    }
  }

  // Token path: keep complete groups from the tail until budget is filled
  if (useTokens && working.length > 0) {
    const budget = options.maxHistoryTokens!;
    const { groups, messageToGroup } = buildGroups(working);
    const groupTokens = groups.map((group) => {
      let tokens = 0;
      for (const id of group) {
        const msg = working.find((m: any) => m.id === id);
        if (msg) tokens += estimateMessageTokens(msg);
      }
      return tokens;
    });

    // Continuous tail window: walk groups from newest → oldest, stop at first
    // group that does not fit. Never skip a large recent group to pick an older
    // small one (that creates history holes). Active/protected groups may
    // exceed budget alone, but once a non-protected group fails we stop.
    const selected = new Set<number>();
    let used = 0;
    const protectedGroups = new Set<number>();
    for (let g = 0; g < groups.length; g++) {
      for (const id of groups[g]) {
        if (protectedIds.has(id)) {
          protectedGroups.add(g);
          break;
        }
      }
    }

    // Newest group index first (groups are in message order)
    for (let g = groups.length - 1; g >= 0; g--) {
      const cost = groupTokens[g] ?? 0;
      const isProtected = protectedGroups.has(g);
      if (selected.size > 0 && !isProtected && used + cost > budget) {
        // First non-fitting non-protected group — stop; do not continue older
        break;
      }
      selected.add(g);
      used += cost;
    }

    // Ensure protected anchors are still present even if they fell outside
    for (const g of protectedGroups) {
      if (!selected.has(g)) {
        selected.add(g);
        used += groupTokens[g] ?? 0;
      }
    }

    const selectedIds = new Set<string>(protectedIds);
    for (const g of selected) groups[g]?.forEach((id) => selectedIds.add(id));
    const before = working.length;
    working = working.filter((msg: any) => selectedIds.has(msg.id));
    log(
      `Token history truncation: budget=${budget} tok, groups kept=${selected.size}/${groups.length}, messages ${before} → ${working.length}`,
    );
  }

  return working;
};

/**
 * History Truncate Processor
 * Responsible for limiting message history based on configuration
 */
export class HistoryTruncateProcessor extends BaseProcessor {
  readonly name = 'HistoryTruncateProcessor';

  constructor(
    private config: HistoryTruncateConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    const originalCount = clonedContext.messages.length;

    // Apply group-aware history truncation (count and/or token budget)
    clonedContext.messages = getSlicedMessages(clonedContext.messages, {
      enableHistoryCount: this.config.enableHistoryCount,
      historyCount: this.config.historyCount,
      maxHistoryTokens: this.config.maxHistoryTokens,
    });

    const finalCount = clonedContext.messages.length;
    const truncatedCount = originalCount - finalCount;

    // Update metadata
    clonedContext.metadata.historyTruncated = truncatedCount;
    clonedContext.metadata.finalMessageCount = finalCount;
    if (this.config.maxHistoryTokens) {
      clonedContext.metadata.historyTokenTruncated = truncatedCount;
    }

    log(
      `History truncation completed (group-aware), truncated ${truncatedCount} messages (${originalCount} → ${finalCount})`,
    );

    return this.markAsExecuted(clonedContext);
  }
}
