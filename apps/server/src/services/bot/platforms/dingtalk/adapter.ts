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

import { splitMessage } from '../../messageSplitting';
import { stripMarkdown } from '../stripMarkdown';
import type { BotPlatformRedisClient } from '../types';
import { ensureDingTalkBusinessSuccess, sendDingTalkRobotMarkdown } from './api';
import {
  DINGTALK_DELIVERY_TARGET_TTL_SECONDS,
  DINGTALK_FALLBACK_CACHE_MAX_ENTRIES,
  DINGTALK_MARKDOWN_CHAR_LIMIT,
} from './const';

/** Inbound robot payload fields we care about (text + media). */
export interface DingTalkRobotMessage {
  /** Some payloads put media under top-level attachments */
  attachments?: Array<{
    downloadCode?: string;
    fileName?: string;
    fileSize?: number | string;
    type?: string;
  }>;
  audio?: { downloadCode?: string; duration?: number };
  /** File message body */
  content?: {
    downloadCode?: string;
    fileName?: string;
    fileSize?: number | string;
    fileType?: string;
  };
  conversationId: string;
  conversationType: string;
  createAt?: number;
  msgId: string;
  msgtype: string;
  picture?: { downloadCode?: string };
  /** Official rich-text payload (array of text/picture segments). */
  richText?: unknown;
  /**
   * Robot code that received the message — required for messageFiles/download
   * to match downloadCode. Prefer over applicationId when present.
   */
  robotCode?: string;
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
  video?: { downloadCode?: string };
}

/** Metadata stored on Message.attachments (no buffers — download in extractFiles). */
export interface DingTalkAttachmentMeta {
  downloadCode: string;
  mimeType?: string;
  name?: string;
  size?: number;
  type: 'file' | 'image' | 'audio' | 'video';
}

const MEDIA_MSGTYPES = new Set(['file', 'picture', 'audio', 'video', 'richText']);

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
const fallbackDeliveryTargets = new Map<
  string,
  { conversationId: string; conversationType: string; expiresAt: number; userId?: string }
>();
const setBoundedFallbackEntry = <T extends { expiresAt: number }>(
  map: Map<string, T>,
  key: string,
  value: T,
): void => {
  const now = Date.now();
  for (const [entryKey, entry] of map) {
    if (entry.expiresAt <= now) map.delete(entryKey);
  }

  // Refresh insertion order so frequently active conversations are retained.
  map.delete(key);
  while (map.size >= DINGTALK_FALLBACK_CACHE_MAX_ENTRIES) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
  map.set(key, value);
};

/** chat stringifyMarkdown emits CommonMark autolinks; strip for plain-text IM. */
export function toDingTalkPlainText(text: string): string {
  return text.replaceAll(/<(https?:\/\/[^>\s]+)>/g, '$1');
}

const guessMime = (name?: string, type?: string): string | undefined => {
  const n = (name || '').toLowerCase();
  if (n.endsWith('.xlsx') || n.endsWith('.xlsm')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (n.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (n.endsWith('.csv')) return 'text/csv';
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.mp4')) return 'video/mp4';
  if (n.endsWith('.mp3')) return 'audio/mpeg';
  if (type === 'image') return 'image/jpeg';
  if (type === 'audio') return 'audio/ogg';
  if (type === 'video') return 'video/mp4';
  return undefined;
};

const parseSize = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
};

/**
 * Collect downloadCode entries from a robot payload (file / picture / attachments).
 * Pure — used by parseMessage and extractFiles.
 */
export function collectDingTalkDownloadables(raw: DingTalkRobotMessage): DingTalkAttachmentMeta[] {
  const out: DingTalkAttachmentMeta[] = [];
  const seen = new Set<string>();

  const push = (meta: DingTalkAttachmentMeta) => {
    const code = meta.downloadCode?.trim();
    if (!code || seen.has(code)) return;
    seen.add(code);
    out.push({ ...meta, downloadCode: code });
  };

  const msgtype = (raw.msgtype || '').toLowerCase();

  if (msgtype === 'file' && raw.content?.downloadCode) {
    const name = raw.content.fileName || 'file';
    push({
      downloadCode: raw.content.downloadCode,
      mimeType: guessMime(name, 'file') || raw.content.fileType,
      name,
      size: parseSize(raw.content.fileSize),
      type: 'file',
    });
  }

  if (msgtype === 'picture') {
    const code = raw.picture?.downloadCode || raw.content?.downloadCode;
    if (code) {
      push({
        downloadCode: code,
        mimeType: 'image/jpeg',
        name: raw.content?.fileName || 'image.jpg',
        size: parseSize(raw.content?.fileSize),
        type: 'image',
      });
    }
  }

  if (msgtype === 'audio') {
    const code = raw.audio?.downloadCode || raw.content?.downloadCode;
    if (code) {
      push({
        downloadCode: code,
        mimeType: 'audio/ogg',
        name: raw.content?.fileName || 'audio.ogg',
        size: parseSize(raw.content?.fileSize),
        type: 'audio',
      });
    }
  }

  if (msgtype === 'video') {
    const code = raw.video?.downloadCode || raw.content?.downloadCode;
    if (code) {
      push({
        downloadCode: code,
        mimeType: 'video/mp4',
        name: raw.content?.fileName || 'video.mp4',
        size: parseSize(raw.content?.fileSize),
        type: 'video',
      });
    }
  }

  // Nested attachments (some enterprise payloads)
  for (const att of raw.attachments || []) {
    if (!att?.downloadCode) continue;
    const name = att.fileName || 'attachment';
    const t =
      att.type === 'image' || att.type === 'picture'
        ? 'image'
        : att.type === 'audio'
          ? 'audio'
          : att.type === 'video'
            ? 'video'
            : 'file';
    push({
      downloadCode: att.downloadCode,
      mimeType: guessMime(name, t),
      name,
      size: parseSize(att.fileSize),
      type: t,
    });
  }

  // Official richText: array of segments with picture.downloadCode or downloadCode
  const rich =
    raw.richText ??
    (raw.content as { richText?: unknown } | undefined)?.richText ??
    (typeof raw.content === 'object' && Array.isArray(raw.content) ? raw.content : undefined);
  if (rich && typeof rich === 'object') {
    const walk = (node: unknown, depth = 0) => {
      if (!node || depth > 8) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      if (typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      const pic = o.picture as { downloadCode?: string } | undefined;
      const code =
        (typeof o.downloadCode === 'string' && o.downloadCode) ||
        (typeof pic?.downloadCode === 'string' && pic.downloadCode) ||
        undefined;
      if (code) {
        const name =
          (typeof o.fileName === 'string' && o.fileName) || (pic ? 'image.jpg' : 'attachment');
        push({
          downloadCode: code,
          mimeType: guessMime(name, pic ? 'image' : 'file'),
          name,
          size: parseSize(o.fileSize),
          type: pic || msgtype === 'picture' ? 'image' : 'file',
        });
      }
      for (const v of Object.values(o)) {
        if (v && typeof v === 'object') walk(v, depth + 1);
      }
    };
    walk(rich);
  }

  // content-only downloadCode without matching msgtype (defensive)
  if (out.length === 0 && raw.content?.downloadCode) {
    const name = raw.content.fileName || 'file';
    push({
      downloadCode: raw.content.downloadCode,
      mimeType: guessMime(name),
      name,
      size: parseSize(raw.content.fileSize),
      type: msgtype === 'picture' ? 'image' : 'file',
    });
  }

  return out;
}

export function isDingTalkInboundAcceptable(raw: DingTalkRobotMessage): boolean {
  if (!raw.conversationId || !raw.sessionWebhook) return false;
  const text = raw.text?.content?.trim();
  if (raw.msgtype === 'text' && text) return true;
  if (MEDIA_MSGTYPES.has(raw.msgtype) && collectDingTalkDownloadables(raw).length > 0) return true;
  // text + attachments hybrid
  if (text && collectDingTalkDownloadables(raw).length > 0) return true;
  return false;
}

export class DingTalkAdapter {
  readonly name = 'dingtalk';
  readonly userName = 'dingtalk-bot';
  private chat!: ChatInstance;

  constructor(
    private readonly applicationId: string,
    private readonly redis?: BotPlatformRedisClient,
    private readonly clientSecret?: string,
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

    if (!isDingTalkInboundAcceptable(raw)) {
      return Response.json({ ok: true });
    }

    const threadId = this.encodeThreadId({
      conversationId: raw.conversationId,
      conversationType: raw.conversationType,
    });
    await this.saveWebhook(threadId, raw.sessionWebhook, raw.sessionWebhookExpiredTime);
    await this.saveDeliveryTarget(threadId, {
      conversationId: raw.conversationId,
      conversationType: raw.conversationType,
      // OpenAPI prefers enterprise userid, but some external robot payloads only
      // expose the encrypted senderId. Keep it as a delivery-only fallback.
      userId: raw.senderStaffId?.trim() || raw.senderId?.trim() || undefined,
    });
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
    const downloadables = collectDingTalkDownloadables(raw);
    const textFromUser = raw.text?.content?.trim() ?? '';
    // Pure-file messages need non-empty text so bot routing still runs.
    const text =
      textFromUser ||
      (downloadables.length > 0 ? downloadables.map((d) => d.name || '附件').join('、') : '');
    const userId = resolveDingTalkAuthorUserId(raw);
    const display = raw.senderNick ?? userId;

    const attachments = downloadables.map((d) => ({
      mimeType: d.mimeType,
      name: d.name,
      // Stash downloadCode for extractFiles (survives Message.toJSON).
      raw: { downloadCode: d.downloadCode, type: d.type },
      size: d.size,
      type: d.type,
    }));

    return new Message({
      attachments,
      author: {
        fullName: display,
        isBot: false,
        isMe: false,
        userId,
        userName: display,
      },
      formatted: parseMarkdown(text || ' '),
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
    const content = this.renderPostable(message);
    const chunks = splitMessage(content, DINGTALK_MARKDOWN_CHAR_LIMIT);
    let raw: unknown;
    let useProactive = !webhook;

    for (const text of chunks) {
      const title =
        toDingTalkPlainText(
          stripMarkdown(text.split('\n').find((line) => line.trim()) ?? ''),
        ).slice(0, 60) || 'YidaLab';
      if (!useProactive && webhook) {
        try {
          const response = await fetch(webhook, {
            body: JSON.stringify({ markdown: { text, title }, msgtype: 'markdown' }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
          });
          if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`HTTP ${response.status} ${detail}`.trim());
          }
          raw = await response.json();
          ensureDingTalkBusinessSuccess(raw, 'sessionWebhook send');
          continue;
        } catch (error) {
          useProactive = true;
          logDeliveryFallback(threadId, error);
        }
      }

      raw = await this.postProactive(threadId, text, title);
    }

    return { id: crypto.randomUUID(), raw, threadId };
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
    return {
      channelId: this.channelIdFromThreadId(threadId),
      id: threadId,
      isDM: this.isDM(threadId),
      metadata: {},
    };
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
    return toDingTalkPlainText(stringifyMarkdown(content));
  }

  private renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === 'string') return message;
    if ('raw' in message) return message.raw;
    if ('markdown' in message) return message.markdown;
    if ('ast' in message) return stringifyMarkdown(message.ast);
    return 'fallbackText' in message ? (message.fallbackText ?? '') : '';
  }

  private key(threadId: string) {
    return `dingtalk:session-webhook:${this.applicationId}:${threadId}`;
  }

  private deliveryTargetKey(threadId: string) {
    return `dingtalk:delivery-target:${this.applicationId}:${threadId}`;
  }

  private async getDeliveryTarget(
    threadId: string,
  ): Promise<{ conversationId: string; conversationType: string; userId?: string } | undefined> {
    const key = this.deliveryTargetKey(threadId);
    const value = this.redis ? await this.redis.get(key) : fallbackDeliveryTargets.get(key);
    if (!value) return undefined;
    if (typeof value !== 'string') {
      if (value.expiresAt < Date.now()) {
        fallbackDeliveryTargets.delete(key);
        return undefined;
      }
      return value;
    }
    try {
      return JSON.parse(value) as {
        conversationId: string;
        conversationType: string;
        userId?: string;
      };
    } catch {
      return undefined;
    }
  }

  private async postProactive(threadId: string, text: string, title: string): Promise<unknown> {
    if (!this.clientSecret) {
      throw new Error('DingTalk session webhook unavailable and proactive credentials are missing');
    }
    const decoded = this.decodeThreadId(threadId);
    const saved = await this.getDeliveryTarget(threadId);
    return sendDingTalkRobotMarkdown({
      clientId: this.applicationId,
      clientSecret: this.clientSecret,
      conversationId: saved?.conversationId ?? decoded.conversationId,
      conversationType: saved?.conversationType ?? decoded.conversationType,
      text,
      title,
      userId: saved?.userId,
    });
  }

  private async saveDeliveryTarget(
    threadId: string,
    target: { conversationId: string; conversationType: string; userId?: string },
  ): Promise<void> {
    const key = this.deliveryTargetKey(threadId);
    if (this.redis) {
      await (this.redis as any).set(
        key,
        JSON.stringify(target),
        'EX',
        DINGTALK_DELIVERY_TARGET_TTL_SECONDS,
      );
      return;
    }
    const now = Date.now();
    setBoundedFallbackEntry(fallbackDeliveryTargets, key, {
      ...target,
      expiresAt: now + DINGTALK_DELIVERY_TARGET_TTL_SECONDS * 1000,
    });
  }

  private async saveWebhook(threadId: string, url: string, expiresAt?: number) {
    const ttlMs = Math.max(60_000, (expiresAt ?? Date.now() + 3_600_000) - Date.now());
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    if (this.redis) {
      await (this.redis as any).set(this.key(threadId), url, 'EX', ttlSeconds);
      return;
    }
    setBoundedFallbackEntry(fallbackWebhooks, this.key(threadId), {
      expiresAt: Date.now() + ttlMs,
      url,
    });
  }

  private async getWebhook(threadId: string): Promise<string | undefined> {
    if (this.redis) return (await this.redis.get(this.key(threadId))) ?? undefined;
    const key = this.key(threadId);
    const item = fallbackWebhooks.get(key);
    if (!item) return undefined;
    if (item.expiresAt < Date.now()) {
      fallbackWebhooks.delete(key);
      return undefined;
    }
    return item.url;
  }
}

const logDeliveryFallback = (threadId: string, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(
    `[DingTalk] sessionWebhook delivery failed; trying proactive API (thread=${threadId}, error=${message})`,
  );
};
