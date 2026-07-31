import { Message, parseMarkdown } from 'chat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DingTalkClient } from './client';

const downloadDingTalkRobotFile = vi.hoisted(() => vi.fn());

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    downloadDingTalkRobotFile,
  };
});

const makeClient = () =>
  new DingTalkClient(
    {
      applicationId: 'robot-app',
      credentials: { clientSecret: 'secret' },
      settings: {},
    } as any,
    {} as any,
  );

const makeFileMessage = (raw: object) =>
  new Message({
    attachments: [],
    author: {
      fullName: 'u',
      isBot: false,
      isMe: false,
      userId: 'u',
      userName: 'u',
    },
    formatted: parseMarkdown('file'),
    id: 'msg-1',
    metadata: { dateSent: new Date(), edited: false },
    raw,
    text: 'file',
    threadId: 'dingtalk:1:cid',
  });

describe('DingTalkClient.extractFiles', () => {
  beforeEach(() => {
    downloadDingTalkRobotFile.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('downloads file by downloadCode from raw payload', async () => {
    downloadDingTalkRobotFile.mockResolvedValue(Buffer.from('xlsx-bytes'));
    const client = makeClient();
    const result = await client.extractFiles!(
      makeFileMessage({
        content: {
          downloadCode: 'CODE-1',
          fileName: 'data.xlsx',
          fileSize: 10,
        },
        msgtype: 'file',
      }),
    );

    expect(downloadDingTalkRobotFile).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'robot-app',
        downloadCode: 'CODE-1',
        robotCode: 'robot-app',
      }),
    );
    expect(result?.files).toHaveLength(1);
    expect(result!.files![0].name).toBe('data.xlsx');
    expect(result!.files![0].buffer?.toString()).toBe('xlsx-bytes');
  });

  it('skips oversized declared size with warning', async () => {
    const client = makeClient();
    const result = await client.extractFiles!(
      makeFileMessage({
        content: {
          downloadCode: 'BIG',
          fileName: 'huge.xlsx',
          fileSize: 50 * 1024 * 1024,
        },
        msgtype: 'file',
      }),
    );

    expect(downloadDingTalkRobotFile).not.toHaveBeenCalled();
    expect(result?.files).toBeUndefined();
    expect(result?.warnings?.[0]).toMatch(/超过/);
  });

  it('returns warning when download fails', async () => {
    downloadDingTalkRobotFile.mockRejectedValue(new Error('HTTP 403'));
    const client = makeClient();
    const result = await client.extractFiles!(
      makeFileMessage({
        content: { downloadCode: 'BAD', fileName: 'x.xlsx' },
        msgtype: 'file',
      }),
    );

    expect(result?.files).toBeUndefined();
    expect(result?.warnings?.[0]).toMatch(/下载失败/);
  });

  it('returns undefined when no download codes', async () => {
    const client = makeClient();
    const result = await client.extractFiles!(makeFileMessage({ msgtype: 'text', text: {} }));
    expect(result).toBeUndefined();
  });
});
