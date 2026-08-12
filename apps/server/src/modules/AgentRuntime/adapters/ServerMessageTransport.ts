import type {
  MessageTransport,
  QueryMessagesInput,
  QueryMessagesOptions,
  RuntimeMessageRef,
  UpdateToolMessageInput,
} from '@lobechat/agent-runtime';
import { parse } from '@lobechat/conversation-flow';
import type { CreateMessageParams, UIChatMessage, UpdateMessageParams } from '@lobechat/types';

import { type MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';
import { recordModelToolDingpanOutcome } from '@/server/services/delivery/recordModelToolOutcome';

import {
  createConversationParentMissingError,
  isMidOperationReferenceMissingError,
} from '../messagePersistErrors';

/**
 * Server {@link MessageTransport} adapter — delegates to `MessageModel` (DB).
 */
export class ServerMessageTransport implements MessageTransport {
  constructor(
    private readonly messageModel: MessageModel,
    private readonly options: {
      db?: LobeChatDatabase;
      postProcessUrl?: (
        path: string | null,
        file: { fileType: string; id?: string | null },
      ) => Promise<string>;
      userId?: string;
      workspaceId?: string | null;
    } = {},
  ) {}

  private async recordDingpanOutcome(params: {
    content?: unknown;
    messageId?: string;
    metadata?: Record<string, unknown> | null;
    plugin?: {
      apiName?: string;
      arguments?: string;
      identifier?: string;
    } | null;
    pluginState?: Record<string, unknown> | null;
  }): Promise<void> {
    const { db, userId, workspaceId } = this.options;
    if (!db || !userId) return;

    // updateToolMessage often omits plugin; infer from metadata stamped by tool executor.
    // Prefer metadata.apiName (set on approval-resume) over hardcoding uploadHtmlToDingpan.
    const plugin =
      params.plugin ??
      (params.metadata?.deliveryType === 'dingpan-report' ||
      params.metadata?.source === 'model-tool'
        ? {
            apiName:
              typeof params.metadata?.apiName === 'string' && params.metadata.apiName.trim()
                ? params.metadata.apiName
                : 'uploadHtmlToDingpan',
            identifier: 'lobe-dingpan',
          }
        : null);

    try {
      const result = await recordModelToolDingpanOutcome({
        content: params.content,
        db,
        metadata: params.metadata,
        plugin,
        pluginArguments: params.plugin?.arguments,
        pluginState: params.pluginState,
        userId,
        workspaceId,
      });
      // Surface attempt id so UI Retry can call redriveDelivery on failure.
      if (result.deliveryAttemptId && params.messageId) {
        await this.messageModel.updatePluginState(params.messageId, {
          deliveryAttemptId: result.deliveryAttemptId,
        });
      }
    } catch (error) {
      // Non-fatal: tool message is already persisted; do not fail the transport write.
      console.error('[ServerMessageTransport] dingpan outcome non-fatal:', error);
    }
  }

  createAssistantMessage(params: CreateMessageParams): Promise<RuntimeMessageRef> {
    return this.messageModel.create(params);
  }

  async createToolMessage(params: CreateMessageParams): Promise<RuntimeMessageRef> {
    try {
      const ref = await this.messageModel.create(params);
      await this.recordDingpanOutcome({
        content: params.content,
        messageId: ref.id,
        metadata: params.metadata as Record<string, unknown> | null | undefined,
        plugin: params.plugin as
          { apiName?: string; arguments?: string; identifier?: string } | null | undefined,
        pluginState: params.pluginState as Record<string, unknown> | null | undefined,
      });
      return ref;
    } catch (error) {
      if (typeof params.parentId === 'string' && isMidOperationReferenceMissingError(error)) {
        throw createConversationParentMissingError(params.parentId, error);
      }
      throw error;
    }
  }

  async deleteMessage(id: string): Promise<void> {
    await this.messageModel.deleteMessage(id);
  }

  async findById(id: string): Promise<RuntimeMessageRef | undefined> {
    const message = await this.messageModel.findById(id);
    return message
      ? {
          agentId: message.agentId,
          groupId: message.groupId,
          id: message.id,
          model: message.model,
          parentId: message.parentId,
          provider: message.provider,
          role: message.role,
          threadId: message.threadId,
          topicId: message.topicId,
        }
      : undefined;
  }

  async query(
    params?: QueryMessagesInput,
    options?: QueryMessagesOptions,
  ): Promise<UIChatMessage[]> {
    const messages = await this.messageModel.query(params, {
      postProcessUrl: options?.resolveAssetUrls ? this.options.postProcessUrl : undefined,
    });

    if (!options?.flatten) return messages;

    const { flatList } = parse(messages);
    return flatList;
  }

  async update(id: string, params: Partial<UpdateMessageParams>): Promise<void> {
    await this.messageModel.update(id, params);
  }

  async updatePluginState(id: string, state: Record<string, any>): Promise<void> {
    await this.messageModel.updatePluginState(id, state);
  }

  async updateToolMessage(id: string, params: UpdateToolMessageInput): Promise<void> {
    await this.messageModel.updateToolMessage(id, params);
    await this.recordDingpanOutcome({
      content: params.content,
      messageId: id,
      metadata: params.metadata as Record<string, unknown> | null | undefined,
      plugin: (params as { plugin?: { apiName?: string; arguments?: string; identifier?: string } })
        .plugin,
      pluginState: params.pluginState as Record<string, unknown> | null | undefined,
    });
  }
}
