import type {
  AdapterPostableMessage,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  RawMessage,
  ThreadInfo,
} from 'chat';
import { Message, parseMarkdown, stringifyMarkdown } from 'chat';

import type { BotPlatformRedisClient } from '../types';

export interface DingTalkRobotMessage {
  conversationId: string;
  conversationType: string;
  createAt?: number;
  msgId: string;
  msgtype: string;
  /**
   * Encrypted sender id from DingTalk. Always present, but **not** the
   * enterprise `userid` operators copy from the admin console / free-login.
   * Prefer {@link senderStaffId} for allowlist / owner identity.
   */
  senderId: string;
  senderNick?: string;
  /**
   * Enterprise staff userid (钉钉 userid). Present on org-internal robots.
   * This is what operators put in `settings.userId` / `allowFrom` — match it.
   */
  senderStaffId?: string;
  sessionWebhook: string;
  sessionWebhookExpiredTime?: number;
  text?: { content?: string };
}

/** Platform identity used for allowFrom / owner gates. Prefer staff userid. */
export function resolveDingTalkAuthorUserId(raw: {
  senderId?: string;
  senderStaffId?: string;
}): string {
  const staff = raw.senderStaffId?.trim();
  if (staff) return staff;
  return (raw.senderId ?? '').trim();
}

const fallbackWebhooks = new Map<string, { expiresAt: number; url: string }>();

export class DingTalkAdapter {
  readonly name = 'dingtalk';
  readonly userName = 'dingtalk-bot';
  private chat!: ChatInstance;

  constructor(
    private readonly applicationId: string,
    private readonly redis?: BotPlatformRedisClient,
  ) {}

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
  }

  async handleWebhook(request: Request): Promise<Response> {
    let raw: DingTalkRobotMessage;
    try {
      raw = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (
      raw.msgtype !== 'text' ||
      !raw.text?.content?.trim() ||
      !raw.conversationId ||
      !raw.sessionWebhook
    ) {
      return Response.json({ ok: true });
    }

    const threadId = this.encodeThreadId({
      conversationId: raw.conversationId,
      conversationType: raw.conversationType,
    });
    await this.saveWebhook(threadId, raw.sessionWebhook, raw.sessionWebhookExpiredTime);
    void this.chat.processMessage(this as any, threadId, () =>
      Promise.resolve(this.parseMessage(raw)),
    );

    return Response.json({ ok: true });
  }

  parseMessage(raw: DingTalkRobotMessage): Message<DingTalkRobotMessage> {
    const threadId = this.encodeThreadId({
      conversationId: raw.conversationId,
      conversationType: raw.conversationType,
    });
    const text = raw.text?.content?.trim() ?? '';
    // allowFrom / settings.userId are enterprise userids → prefer senderStaffId
    const userId = resolveDingTalkAuthorUserId(raw);
    const display = raw.senderNick ?? userId;

    return new Message({
      attachments: [],
      author: {
        fullName: display,
        isBot: false,
        isMe: false,
        userId,
        userName: display,
      },
      formatted: parseMarkdown(text),
      id: raw.msgId,
      metadata: { dateSent: new Date(raw.createAt ?? Date.now()), edited: false },
      raw,
      text,
      threadId,
    });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<unknown>> {
    const webhook = await this.getWebhook(threadId);
    if (!webhook)
      throw new Error('DingTalk session webhook has expired. Send a new message to continue.');

    const response = await fetch(webhook, {
      body: JSON.stringify({ msgtype: 'text', text: { content: this.renderPostable(message) } }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) throw new Error(`DingTalk reply failed: HTTP ${response.status}`);

    return { id: crypto.randomUUID(), raw: await response.json() };
  }

  editMessage(threadId: string, _messageId: string, message: AdapterPostableMessage) {
    return this.postMessage(threadId, message);
  }

  async deleteMessage(): Promise<void> {}
  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {}
  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {}
  async startTyping(): Promise<void> {}
  async fetchMessages(_threadId: string, _options?: FetchOptions): Promise<FetchResult<unknown>> {
    return { messages: [] };
  }
  async fetchThread(threadId: string): Promise<ThreadInfo> {
    return { createdAt: new Date(), id: threadId, title: undefined };
  }
  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }
  isDM(threadId: string): boolean {
    return this.decodeThreadId(threadId).conversationType !== '2';
  }
  encodeThreadId(data: { conversationId: string; conversationType: string }): string {
    return `dingtalk:${data.conversationType}:${data.conversationId}`;
  }
  decodeThreadId(threadId: string) {
    const [, conversationType = '1', ...parts] = threadId.split(':');
    return { conversationId: parts.join(':'), conversationType };
  }
  renderFormatted(content: FormattedContent): string {
    return stringifyMarkdown(content.ast);
  }

  private renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === 'string') return message;
    if ('raw' in message) return message.raw;
    if ('markdown' in message) return stringifyMarkdown(parseMarkdown(message.markdown));
    if ('ast' in message) return stringifyMarkdown(message.ast);
    return 'fallbackText' in message ? (message.fallbackText ?? '') : '';
  }

  private key(threadId: string) {
    return `dingtalk:session-webhook:${this.applicationId}:${threadId}`;
  }

  private async saveWebhook(threadId: string, url: string, expiresAt?: number) {
    const ttlMs = Math.max(60_000, (expiresAt ?? Date.now() + 3_600_000) - Date.now());
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    if (this.redis) {
      // ioredis is passed as redisClient; EX form (not Upstash { ex }).
      await (this.redis as any).set(this.key(threadId), url, 'EX', ttlSeconds);
      return;
    }
    // ponytail: process-local fallback only; configure Redis before running multiple server instances.
    fallbackWebhooks.set(this.key(threadId), { expiresAt: Date.now() + ttlMs, url });
  }

  private async getWebhook(threadId: string): Promise<string | undefined> {
    if (this.redis) return (await this.redis.get(this.key(threadId))) ?? undefined;
    const item = fallbackWebhooks.get(this.key(threadId));
    if (!item || item.expiresAt < Date.now()) return undefined;
    return item.url;
  }
}
