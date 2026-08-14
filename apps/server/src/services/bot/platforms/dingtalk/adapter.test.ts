import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectDingTalkDownloadables,
  DingTalkAdapter,
  isDingTalkInboundAcceptable,
  toDingTalkPlainText,
} from './adapter';
import { DINGTALK_FALLBACK_CACHE_MAX_ENTRIES, DINGTALK_REQUEST_TIMEOUT_MS } from './const';

describe('DingTalkAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('strips angle-bracket autolinks for plain-text session webhook', () => {
    const url =
      'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=2&type=file';
    expect(toDingTalkPlainText(`报告链接：\n<${url}>`)).toBe(`报告链接：\n${url}`);
  });

  it('posts markdown messages without angle-bracket autolinks around bare urls', async () => {
    const processMessage = vi.fn();
    const adapter = new DingTalkAdapter('app-1');
    await adapter.initialize({ processMessage } as any);

    await adapter.handleWebhook(
      new Request('https://example.com', {
        body: JSON.stringify({
          conversationId: 'cid-1',
          conversationType: '1',
          msgId: 'msg-md',
          msgtype: 'text',
          senderId: 'user-1',
          sessionWebhook: 'https://dingtalk.example/reply',
          text: { content: 'hello' },
        }),
        method: 'POST',
      }),
    );

    const fetch = vi.fn().mockImplementation(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const url =
      'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=2&type=file';
    await adapter.postMessage('dingtalk:1:cid-1', {
      markdown: `报告链接：\n${url}`,
    } as any);

    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.msgtype).toBe('markdown');
    expect(body.markdown.text).toContain(url);
    expect(body.markdown.text).not.toContain(`<${url}>`);
  });

  it('routes an incoming text message and replies through its session webhook', async () => {
    const processMessage = vi.fn();
    const adapter = new DingTalkAdapter('app-1');
    await adapter.initialize({ processMessage } as any);

    await adapter.handleWebhook(
      new Request('https://example.com', {
        body: JSON.stringify({
          conversationId: 'cid-1',
          conversationType: '1',
          msgId: 'msg-1',
          msgtype: 'text',
          senderId: 'user-1',
          sessionWebhook: 'https://dingtalk.example/reply',
          text: { content: 'hello' },
        }),
        method: 'POST',
      }),
    );

    expect(processMessage).toHaveBeenCalledOnce();
    expect((await processMessage.mock.calls[0][2]()).text).toBe('hello');

    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await adapter.postMessage('dingtalk:1:cid-1', 'world');

    expect(fetch).toHaveBeenCalledWith(
      'https://dingtalk.example/reply',
      expect.objectContaining({
        body: JSON.stringify({ markdown: { text: 'world', title: 'world' }, msgtype: 'markdown' }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('bounds session webhook delivery with the DingTalk request timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const adapter = new DingTalkAdapter('app-timeout');
    await adapter.initialize({ processMessage: vi.fn() } as any);
    await adapter.handleWebhook(
      new Request('https://example.com', {
        body: JSON.stringify({
          conversationId: 'cid-timeout',
          conversationType: '1',
          msgId: 'msg-timeout',
          msgtype: 'text',
          senderId: 'user-timeout',
          sessionWebhook: 'https://dingtalk.example/timeout',
          text: { content: 'hello' },
        }),
        method: 'POST',
      }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));

    await adapter.postMessage('dingtalk:1:cid-timeout', 'bounded reply');

    expect(timeout).toHaveBeenCalledWith(DINGTALK_REQUEST_TIMEOUT_MS);
  });

  it('falls back to proactive delivery when sessionWebhook returns a business failure', async () => {
    const processMessage = vi.fn();
    const adapter = new DingTalkAdapter('app-business-fallback', undefined, 'secret');
    await adapter.initialize({ processMessage } as any);

    await adapter.handleWebhook(
      new Request('https://example.com', {
        body: JSON.stringify({
          conversationId: 'cid-business-fallback',
          conversationType: '1',
          msgId: 'msg-business-fallback',
          msgtype: 'text',
          senderId: 'encrypted-user',
          senderStaffId: 'staff-user',
          sessionWebhook: 'https://dingtalk.example/business-failure',
          text: { content: 'hello' },
        }),
        method: 'POST',
      }),
    );

    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errcode: 310000, errmsg: 'session webhook expired' })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'fallback-token', expireIn: 7200 })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ processQueryKey: 'delivered' })));
    vi.stubGlobal('fetch', fetch);

    await adapter.postMessage('dingtalk:1:cid-business-fallback', '完整回复');

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][0]).toContain('/robot/oToMessages/batchSend');
    expect(JSON.parse(fetch.mock.calls[2][1].body as string)).toEqual(
      expect.objectContaining({
        robotCode: 'app-business-fallback',
        userIds: ['staff-user'],
      }),
    );
  });

  it('uses encrypted senderId when an expired DM webhook has no senderStaffId', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T00:00:00Z'));
    const processMessage = vi.fn();
    const adapter = new DingTalkAdapter('app-expired-dm', undefined, 'secret');
    await adapter.initialize({ processMessage } as any);
    await adapter.handleWebhook(
      new Request('https://example.com', {
        body: JSON.stringify({
          conversationId: 'cid-expired-dm',
          conversationType: '1',
          msgId: 'msg-expired-dm',
          msgtype: 'text',
          senderId: 'encrypted-only-user',
          sessionWebhook: 'https://dingtalk.example/expired-dm',
          sessionWebhookExpiredTime: Date.now() + 1000,
          text: { content: 'hello' },
        }),
        method: 'POST',
      }),
    );
    vi.setSystemTime(Date.now() + 61_000);

    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'expired-dm-token', expireIn: 7200 })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ processQueryKey: 'delivered' })));
    vi.stubGlobal('fetch', fetch);

    await adapter.postMessage('dingtalk:1:cid-expired-dm', '完整回复');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toContain('/robot/oToMessages/batchSend');
    expect(JSON.parse(fetch.mock.calls[1][1].body as string)).toEqual(
      expect.objectContaining({ userIds: ['encrypted-only-user'] }),
    );
  });

  it('falls back from an HTTP 4xx webhook to group proactive delivery by conversationId', async () => {
    const processMessage = vi.fn();
    const adapter = new DingTalkAdapter('app-group-fallback', undefined, 'secret');
    await adapter.initialize({ processMessage } as any);
    await adapter.handleWebhook(
      new Request('https://example.com', {
        body: JSON.stringify({
          conversationId: 'cid-group-fallback',
          conversationType: '2',
          msgId: 'msg-group-fallback',
          msgtype: 'text',
          senderId: 'group-user',
          sessionWebhook: 'https://dingtalk.example/group-expired',
          text: { content: 'hello' },
        }),
        method: 'POST',
      }),
    );

    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 410 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'group-token', expireIn: 7200 })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ processQueryKey: 'delivered' })));
    vi.stubGlobal('fetch', fetch);

    await adapter.postMessage('dingtalk:2:cid-group-fallback', '群聊完整回复');

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][0]).toContain('/robot/groupMessages/send');
    expect(JSON.parse(fetch.mock.calls[2][1].body as string)).toEqual(
      expect.objectContaining({ openConversationId: 'cid-group-fallback' }),
    );
  });

  it('bounds no-Redis delivery targets and evicts the oldest conversation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T00:00:00Z'));
    const processMessage = vi.fn();
    const adapter = new DingTalkAdapter('app-bounded-cache', undefined, 'secret');
    await adapter.initialize({ processMessage } as any);

    for (let index = 0; index <= DINGTALK_FALLBACK_CACHE_MAX_ENTRIES; index++) {
      await adapter.handleWebhook(
        new Request('https://example.com', {
          body: JSON.stringify({
            conversationId: `cid-cache-${index}`,
            conversationType: '1',
            msgId: `msg-cache-${index}`,
            msgtype: 'text',
            senderId: `user-cache-${index}`,
            sessionWebhook: `https://dingtalk.example/cache-${index}`,
            sessionWebhookExpiredTime: Date.now() + 1000,
            text: { content: 'hello' },
          }),
          method: 'POST',
        }),
      );
    }
    vi.setSystemTime(Date.now() + 61_000);

    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'bounded-cache-token', expireIn: 7200 })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ processQueryKey: 'delivered' })));
    vi.stubGlobal('fetch', fetch);

    await expect(adapter.postMessage('dingtalk:1:cid-cache-0', 'oldest')).rejects.toThrow(
      /senderStaffId or senderId/,
    );
    await adapter.postMessage(
      `dingtalk:1:cid-cache-${DINGTALK_FALLBACK_CACHE_MAX_ENTRIES}`,
      'newest',
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body as string)).toEqual(
      expect.objectContaining({
        userIds: [`user-cache-${DINGTALK_FALLBACK_CACHE_MAX_ENTRIES}`],
      }),
    );
  });

  it('preserves Markdown structure in the session webhook payload', async () => {
    const processMessage = vi.fn();
    const adapter = new DingTalkAdapter('app-1');
    await adapter.initialize({ processMessage } as any);

    await adapter.handleWebhook(
      new Request('https://example.com', {
        body: JSON.stringify({
          conversationId: 'cid-md',
          conversationType: '1',
          msgId: 'msg-md-structure',
          msgtype: 'text',
          senderId: 'user-1',
          sessionWebhook: 'https://dingtalk.example/reply-md',
          text: { content: 'hello' },
        }),
        method: 'POST',
      }),
    );

    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await adapter.postMessage('dingtalk:1:cid-md', '**结论**\n\n- 建议一\n- 建议二');

    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.markdown).toEqual({
      text: '**结论**\n\n- 建议一\n- 建议二',
      title: '结论',
    });
  });

  it('delivers long replies as complete session-webhook chunks', async () => {
    const processMessage = vi.fn();
    const adapter = new DingTalkAdapter('app-1');
    await adapter.initialize({ processMessage } as any);

    await adapter.handleWebhook(
      new Request('https://example.com', {
        body: JSON.stringify({
          conversationId: 'cid-long',
          conversationType: '1',
          msgId: 'msg-long',
          msgtype: 'text',
          senderId: 'user-1',
          sessionWebhook: 'https://dingtalk.example/reply-long',
          text: { content: 'hello' },
        }),
        method: 'POST',
      }),
    );

    const fetch = vi.fn().mockImplementation(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const reply = '完整分析。'.repeat(800);

    await adapter.postMessage('dingtalk:1:cid-long', reply);

    expect(fetch).toHaveBeenCalledTimes(2);
    const chunks = fetch.mock.calls.map((call) => {
      const body = JSON.parse(call[1].body as string);
      return body.markdown.text as string;
    });
    expect(chunks.every((chunk) => chunk.length <= 3500)).toBe(true);
    expect(chunks.join('')).toBe(reply);
    expect(chunks.join('')).not.toContain('Web 查看');
  });

  it('prefers senderStaffId (enterprise userid) over encrypted senderId for allowlist identity', async () => {
    const processMessage = vi.fn();
    const adapter = new DingTalkAdapter('app-1');
    await adapter.initialize({ processMessage } as any);

    await adapter.handleWebhook(
      new Request('https://example.com', {
        body: JSON.stringify({
          conversationId: 'cid-1',
          conversationType: '1',
          msgId: 'msg-2',
          msgtype: 'text',
          senderId: 'encrypted-sender-id',
          senderNick: '柯鹏翔',
          senderStaffId: '17331048354297047',
          sessionWebhook: 'https://dingtalk.example/reply',
          text: { content: 'hi' },
        }),
        method: 'POST',
      }),
    );

    const message = await processMessage.mock.calls[0][2]();
    expect(message.author.userId).toBe('17331048354297047');
    expect(message.author.userName).toBe('柯鹏翔');
  });

  it('accepts file messages and parses downloadCode metadata', async () => {
    const processMessage = vi.fn();
    const adapter = new DingTalkAdapter('app-1');
    await adapter.initialize({ processMessage } as any);

    await adapter.handleWebhook(
      new Request('https://example.com', {
        body: JSON.stringify({
          content: {
            downloadCode: 'CODE-XLSX',
            fileName: '词库.xlsx',
            fileSize: 1024,
          },
          conversationId: 'cid-file',
          conversationType: '1',
          msgId: 'msg-file',
          msgtype: 'file',
          senderId: 'user-1',
          sessionWebhook: 'https://dingtalk.example/reply',
        }),
        method: 'POST',
      }),
    );

    expect(processMessage).toHaveBeenCalledOnce();
    const message = await processMessage.mock.calls[0][2]();
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].name).toBe('词库.xlsx');
    expect(message.attachments[0].raw).toEqual({
      downloadCode: 'CODE-XLSX',
      type: 'file',
    });
    expect(message.text).toContain('词库.xlsx');
  });

  it('ignores file messages without downloadCode', async () => {
    const processMessage = vi.fn();
    const adapter = new DingTalkAdapter('app-1');
    await adapter.initialize({ processMessage } as any);

    await adapter.handleWebhook(
      new Request('https://example.com', {
        body: JSON.stringify({
          conversationId: 'cid-1',
          conversationType: '1',
          msgId: 'msg-x',
          msgtype: 'file',
          senderId: 'user-1',
          sessionWebhook: 'https://dingtalk.example/reply',
        }),
        method: 'POST',
      }),
    );

    expect(processMessage).not.toHaveBeenCalled();
  });

  it('collectDingTalkDownloadables dedupes codes from nested attachments', () => {
    const items = collectDingTalkDownloadables({
      attachments: [
        { downloadCode: 'A', fileName: 'a.xlsx' },
        { downloadCode: 'A', fileName: 'dup.xlsx' },
        { downloadCode: 'B', fileName: 'b.pdf' },
      ],
      conversationId: 'c',
      conversationType: '1',
      msgId: 'm',
      msgtype: 'file',
      senderId: 'u',
      sessionWebhook: 'https://x',
      content: { downloadCode: 'A', fileName: 'a.xlsx' },
    });
    expect(items.map((i) => i.downloadCode).sort()).toEqual(['A', 'B']);
  });

  it('isDingTalkInboundAcceptable for picture', () => {
    expect(
      isDingTalkInboundAcceptable({
        conversationId: 'c',
        conversationType: '1',
        msgId: 'm',
        msgtype: 'picture',
        picture: { downloadCode: 'PIC' },
        senderId: 'u',
        sessionWebhook: 'https://x',
      }),
    ).toBe(true);
  });

  it('collects downloadCode from richText picture segments', () => {
    const items = collectDingTalkDownloadables({
      conversationId: 'c',
      conversationType: '1',
      msgId: 'm',
      msgtype: 'richText',
      richText: [{ text: 'see' }, { picture: { downloadCode: 'RICH-PIC' } }],
      senderId: 'u',
      sessionWebhook: 'https://x',
    });
    expect(items.some((i) => i.downloadCode === 'RICH-PIC')).toBe(true);
  });
});
