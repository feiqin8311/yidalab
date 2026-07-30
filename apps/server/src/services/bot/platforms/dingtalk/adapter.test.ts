import { afterEach, describe, expect, it, vi } from 'vitest';

import { DingTalkAdapter, toDingTalkPlainText } from './adapter';

describe('DingTalkAdapter', () => {
  afterEach(() => vi.unstubAllGlobals());

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

    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const url =
      'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=2&type=file';
    await adapter.postMessage('dingtalk:1:cid-1', {
      markdown: `报告链接：\n${url}`,
    } as any);

    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.text.content).toContain(url);
    expect(body.text.content).not.toContain(`<${url}>`);
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
        body: JSON.stringify({ msgtype: 'text', text: { content: 'world' } }),
      }),
    );
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
});
