import type {
  CompressionGroupCancelInput,
  CompressionGroupCancelResult,
  CompressionGroupCreateInput,
  CompressionGroupCreateResult,
  CompressionGroupFinalizeInput,
  CompressionGroupFinalizeResult,
  CompressionParseInput,
  CompressionParseResult,
  CompressionPromptInput,
  CompressionPromptResult,
  CompressionTransport,
} from '@lobechat/agent-runtime';
import {
  chainCompressContext,
  finalizeCompressionOutput,
  resolveMaxSummaryTokens,
} from '@lobechat/prompts';
import type { CompressionGroupMetadata } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';
import { MessageService } from '@/server/services/message';

/**
 * Server {@link CompressionTransport} adapter — owns DB-backed compression
 * group persistence and the compression prompt policy used by the server path.
 *
 * Validation lives in {@link parseOutput} (throws on invalid schema).
 * {@link finalizeGroup} only persists already-validated content + snapshot.
 */
export class ServerCompressionTransport implements CompressionTransport {
  constructor(
    private readonly serverDB: LobeChatDatabase,
    private readonly userId: string,
    private readonly defaultWorkspaceId?: string,
  ) {}

  async buildPrompt(input: CompressionPromptInput): Promise<CompressionPromptResult> {
    const payload = chainCompressContext({
      existingSnapshot: input.existingSnapshot,
      legacySummary: input.legacySummary ?? input.existingSummary,
      maxSummaryTokens: input.maxSummaryTokens ?? resolveMaxSummaryTokens(),
      messages: input.messages.map((m) => ({
        content: typeof m.content === 'string' ? m.content : '',
        id: m.id,
        role: m.role,
      })),
    });
    return { messages: payload.messages! };
  }

  async parseOutput(input: CompressionParseInput): Promise<CompressionParseResult> {
    const result = finalizeCompressionOutput({
      currentUserMessageIds: input.currentUserMessageIds,
      maxSummaryTokens: input.maxSummaryTokens,
      messageIds: input.messageIds,
      previousSnapshot: input.existingSnapshot,
      raw: input.raw,
      sourceGroupIds: input.sourceGroupIds,
      userMessages: input.userMessages,
    });

    const degraded: NonNullable<CompressionGroupMetadata['degraded']> = [];
    if (result.repaired) degraded.push('validation_repaired');
    if (result.budgetTrimmed) degraded.push('budget_trimmed');

    return {
      content: result.content,
      metadata: {
        activeHardConstraintCount: result.activeHardConstraintCount,
        degraded: degraded.length > 0 ? degraded : undefined,
        newConstraintCount: result.newConstraintCount,
        snapshot: result.snapshot,
        snapshotVersion: 2,
        supersededConstraintCount: result.supersededConstraintCount,
        tokensAfter: result.content.length,
      },
      snapshot: result.snapshot,
    };
  }

  async createGroup(input: CompressionGroupCreateInput): Promise<CompressionGroupCreateResult> {
    const service = this.createService(input.workspaceId);
    const result = await service.createCompressionGroup(input.topicId, input.messageIds, {
      agentId: input.agentId,
      groupId: input.groupId,
      threadId: input.threadId,
      topicId: input.topicId,
    } as any);

    return {
      messageGroupId: result.messageGroupId,
      messages: result.messages,
      messagesToSummarize: result.messagesToSummarize,
    };
  }

  async cancelGroup(input: CompressionGroupCancelInput): Promise<CompressionGroupCancelResult> {
    const service = this.createService(input.workspaceId);
    const result = await service.cancelCompression(input.messageGroupId, {
      agentId: input.agentId,
      groupId: input.groupId,
      threadId: input.threadId,
      topicId: input.topicId,
    } as any);

    return { messages: result.messages };
  }

  async finalizeGroup(
    input: CompressionGroupFinalizeInput,
  ): Promise<CompressionGroupFinalizeResult> {
    const service = this.createService(input.workspaceId);

    // Persist validated markdown + snapshot only — no re-parse / silent fallback
    const metadata: Partial<CompressionGroupMetadata> = {
      ...input.metadata,
      ...(input.snapshot
        ? {
            snapshot: input.snapshot,
            snapshotVersion: 2,
          }
        : {}),
      mergedGroupIds: input.mergeGroupIds ?? input.metadata?.mergedGroupIds,
    };

    const result = await service.finalizeCompression(input.messageGroupId, input.content, {
      agentId: input.agentId,
      groupId: input.groupId,
      mergeGroupIds: input.mergeGroupIds,
      messageIds: input.messageIds,
      metadata,
      threadId: input.threadId,
      topicId: input.topicId,
    } as any);

    return {
      messages: result.messages,
    };
  }

  private createService(workspaceId?: string) {
    return new MessageService(this.serverDB, this.userId, workspaceId ?? this.defaultWorkspaceId);
  }
}
