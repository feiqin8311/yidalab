import debug from 'debug';

import {
  BOT_RUNTIME_STATUSES,
  getRuntimeStatusErrorMessage,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

import { stripMarkdown } from '../stripMarkdown';
import {
  type BotPlatformRuntimeContext,
  type BotProviderConfig,
  ClientFactory,
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';
import { DingTalkAdapter } from './adapter';
import { dingTalkMessageEmotion } from './api';
import { DingTalkStreamConnection } from './gateway';

const log = debug('bot-platform:dingtalk');

export class DingTalkClient implements PlatformClient {
  readonly applicationId: string;
  readonly id = 'dingtalk';
  private connection?: DingTalkStreamConnection;

  constructor(
    private readonly config: BotProviderConfig,
    private readonly context: BotPlatformRuntimeContext,
  ) {
    this.applicationId = config.applicationId;
  }

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
    // Text replies go through the Stream session webhook (chat-sdk adapter).
    // Reactions use OpenAPI robot emotion reply/recall (same as reimburse-bot).
    return {
      createMessage: async () => {
        throw new Error('DingTalk replies are sent through the active Stream session');
      },
      editMessage: async () => {
        throw new Error('DingTalk replies are sent through the active Stream session');
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
    return stripMarkdown(markdown);
  }
  formatReply(body: string, stats?: UsageStats): string {
    return stats && this.config.settings.showUsageStats
      ? `${body}\n\n${formatUsageStats(stats)}`
      : body;
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
