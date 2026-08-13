import type { Message } from 'chat';
import debug from 'debug';

import type { AttachmentSource } from '@/server/services/aiAgent/ingestAttachment';
import {
  BOT_RUNTIME_STATUSES,
  getRuntimeStatusErrorMessage,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

import {
  type BotPlatformRuntimeContext,
  type BotProviderConfig,
  ClientFactory,
  type ExtractFilesResult,
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';
import {
  collectDingTalkDownloadables,
  DingTalkAdapter,
  type DingTalkRobotMessage,
} from './adapter';
import {
  createDingTalkAICard,
  resolveDingTalkAICardTemplateId,
  updateDingTalkAICard,
} from './aiCard';
import {
  DINGTALK_MAX_ROBOT_FILE_BYTES,
  dingTalkMessageEmotion,
  downloadDingTalkRobotFile,
} from './api';
import { DingTalkStreamConnection } from './gateway';

const log = debug('bot-platform:dingtalk');

export class DingTalkClient implements PlatformClient {
  readonly applicationId: string;
  readonly id = 'dingtalk';
  readonly supportsMessageEdit: boolean;
  private connection?: DingTalkStreamConnection;
  private readonly aiCardTemplateId?: string;

  constructor(
    private readonly config: BotProviderConfig,
    private readonly context: BotPlatformRuntimeContext,
  ) {
    this.applicationId = config.applicationId;
    this.aiCardTemplateId = resolveDingTalkAICardTemplateId(config.settings);
    this.supportsMessageEdit = !!this.aiCardTemplateId;
  }

  createProgressMessage = async (params: {
    content: string;
    platformThreadId: string;
    platformUserId?: string;
  }): Promise<{ id: string } | undefined> => {
    const clientSecret = this.config.credentials.clientSecret;
    const userId = params.platformUserId?.trim();
    const conversationType = params.platformThreadId.split(':')[1];
    // The current AI Card delivery contract targets the invoking user's robot
    // DM space. Never pull a group conversation into a surprising private DM.
    if (conversationType === '2' || !this.aiCardTemplateId || !clientSecret || !userId) {
      return undefined;
    }

    const id = await createDingTalkAICard({
      config: {
        clientId: this.applicationId,
        clientSecret,
        templateId: this.aiCardTemplateId,
      },
      content: params.content,
      userId,
    });
    return { id };
  };

  private decodeConversationId(platformThreadId: string): string {
    // threadId: dingtalk:<conversationType>:<conversationId>
    const parts = platformThreadId.split(':');
    return parts.slice(2).join(':');
  }

  private async emotion(
    platformThreadId: string,
    msgId: string,
    opts: { recall?: boolean },
  ): Promise<void> {
    const clientSecret = this.config.credentials.clientSecret;
    if (!clientSecret) return;
    await dingTalkMessageEmotion({
      clientId: this.applicationId,
      clientSecret,
      conversationId: this.decodeConversationId(platformThreadId),
      msgId,
      recall: opts.recall,
    });
  }

  async start(): Promise<void> {
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });
    try {
      const appUrl = this.context.appUrl?.replace(/\/$/, '');
      if (!appUrl) throw new Error('APP_URL is required for DingTalk Stream mode');
      this.connection = new DingTalkStreamConnection(
        this.applicationId,
        this.config.credentials.clientSecret,
        `${appUrl}/api/agent/webhooks/dingtalk/${this.applicationId}`,
      );
      await this.connection.start();
      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });
    } catch (error) {
      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        errorMessage: getRuntimeStatusErrorMessage(error),
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.failed,
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.connection?.stop();
    this.connection = undefined;
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

  createAdapter(): Record<string, any> {
    return { dingtalk: new DingTalkAdapter(this.applicationId, this.context.redisClient) };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const adapter = new DingTalkAdapter(this.applicationId, this.context.redisClient);
    const clientSecret = this.config.credentials.clientSecret;
    const toText = (content: unknown) => {
      if (typeof content === 'string') return content;
      if (content && typeof content === 'object' && 'content' in content) {
        const inner = (content as { content?: unknown }).content;
        if (typeof inner === 'string') return inner;
      }
      return '';
    };

    return {
      completeMessage: async (messageId, content) => {
        if (!this.aiCardTemplateId || !clientSecret || !messageId.startsWith('yidalab_')) {
          await adapter.postMessage(platformThreadId, toText(content));
          return;
        }
        await updateDingTalkAICard({
          cardInstanceId: messageId,
          config: {
            clientId: this.applicationId,
            clientSecret,
            templateId: this.aiCardTemplateId,
          },
          content: toText(content),
          finished: true,
        });
      },
      createMessage: async (content) => {
        await adapter.postMessage(platformThreadId, toText(content));
      },
      editMessage: async (messageId, content) => {
        if (!this.aiCardTemplateId || !clientSecret || !messageId.startsWith('yidalab_')) {
          await adapter.postMessage(platformThreadId, toText(content));
          return;
        }
        await updateDingTalkAICard({
          cardInstanceId: messageId,
          config: {
            clientId: this.applicationId,
            clientSecret,
            templateId: this.aiCardTemplateId,
          },
          content: toText(content),
          finished: false,
        });
      },
      addReaction: async (messageId) => {
        await this.emotion(platformThreadId, String(messageId), { recall: false });
      },
      removeReaction: async (messageId) => {
        await this.emotion(platformThreadId, String(messageId), { recall: true });
      },
      replaceReaction: async (messageId, _prevEmoji, nextEmoji) => {
        await this.emotion(platformThreadId, String(messageId), {
          recall: nextEmoji == null,
        });
      },
    };
  }
  extractChatId(platformThreadId: string): string {
    return platformThreadId;
  }
  parseMessageId(compositeId: string): string {
    return compositeId;
  }
  formatMarkdown(markdown: string): string {
    return markdown;
  }
  formatReply(body: string, stats?: UsageStats): string {
    return stats && this.config.settings.showUsageStats
      ? `${body}\n\n${formatUsageStats(stats)}`
      : body;
  }

  /**
   * Re-download media via OpenAPI using downloadCode from message.raw
   * (Message.toJSON strips buffers; codes survive Redis round-trip).
   */
  async extractFiles(message: Message): Promise<ExtractFilesResult | undefined> {
    const clientSecret = this.config.credentials.clientSecret;
    if (!clientSecret) {
      log('extractFiles: missing clientSecret');
      return undefined;
    }

    const raw = message.raw as DingTalkRobotMessage | undefined;
    const downloadables = raw ? collectDingTalkDownloadables(raw) : [];
    // Fallback: attachment.raw.downloadCode from parseMessage metadata
    if (downloadables.length === 0 && Array.isArray(message.attachments)) {
      for (const att of message.attachments) {
        const code = (att as { raw?: { downloadCode?: string } }).raw?.downloadCode;
        if (!code) continue;
        downloadables.push({
          downloadCode: code,
          mimeType: att.mimeType,
          name: att.name,
          size: att.size,
          type: (att.type as 'file' | 'image' | 'audio' | 'video') || 'file',
        });
      }
    }

    if (downloadables.length === 0) return undefined;

    const files: AttachmentSource[] = [];
    const warnings: string[] = [];

    for (const item of downloadables) {
      const declared = item.size ?? 0;
      if (declared > DINGTALK_MAX_ROBOT_FILE_BYTES) {
        warnings.push(
          `附件「${item.name || 'file'}」声明大小 ${Math.round(declared / 1024 / 1024)}MB 超过 ${DINGTALK_MAX_ROBOT_FILE_BYTES / 1024 / 1024}MB 上限，已跳过。`,
        );
        continue;
      }
      try {
        // Official API requires robotCode matching the robot that received the message.
        const robotCode = raw?.robotCode?.trim() || this.applicationId;
        const buffer = await downloadDingTalkRobotFile({
          clientId: this.applicationId,
          clientSecret,
          downloadCode: item.downloadCode,
          maxBytes: DINGTALK_MAX_ROBOT_FILE_BYTES,
          robotCode,
        });
        files.push({
          buffer,
          mimeType: item.mimeType,
          name: item.name,
          size: buffer.length,
        });
        log(
          'extractFiles: downloaded %s (%d bytes) type=%s',
          item.name ?? item.downloadCode.slice(0, 8),
          buffer.length,
          item.type,
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log('extractFiles: failed for %s: %O', item.name ?? item.downloadCode, error);
        warnings.push(`附件「${item.name || 'file'}」下载失败：${msg.slice(0, 120)}`);
      }
    }

    if (files.length === 0 && warnings.length === 0) return undefined;
    return { files: files.length > 0 ? files : undefined, warnings };
  }
}

export class DingTalkClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new DingTalkClient(config, context);
  }
  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    if (!applicationId || !credentials.clientSecret)
      return {
        errors: [{ field: 'applicationId', message: 'Client ID and Client Secret are required' }],
        valid: false,
      };
    try {
      const response = await fetch('https://api.dingtalk.com/v1.0/gateway/connections/open', {
        body: JSON.stringify({
          clientId: applicationId,
          clientSecret: credentials.clientSecret,
          subscriptions: [{ topic: '/v1.0/im/bot/messages/get', type: 'CALLBACK' }],
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { valid: true };
    } catch (error) {
      log('DingTalk credential validation failed: %O', error);
      return {
        errors: [
          { field: 'clientSecret', message: 'Failed to authenticate with DingTalk Stream API' },
        ],
        valid: false,
      };
    }
  }
}
