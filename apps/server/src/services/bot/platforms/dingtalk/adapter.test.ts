import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectDingTalkDownloadables,
  DingTalkAdapter,
  isDingTalkInboundAcceptable,
  toDingTalkPlainText,
} from './adapter';

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
