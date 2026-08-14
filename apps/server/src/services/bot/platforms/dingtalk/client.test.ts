import { Message, parseMarkdown } from 'chat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DingTalkClient } from './client';

const { createDingTalkAICard, downloadDingTalkRobotFile, updateDingTalkAICard } = vi.hoisted(
  () => ({
    createDingTalkAICard: vi.fn(),
    downloadDingTalkRobotFile: vi.fn(),
    updateDingTalkAICard: vi.fn(),
  }),
);

vi.mock('./api', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    downloadDingTalkRobotFile,
  };
});

vi.mock('./aiCard', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    createDingTalkAICard,
    updateDingTalkAICard,
  };
});

const makeClient = (settings: Record<string, unknown> = {}) =>
  new DingTalkClient(
    {
      applicationId: 'robot-app',
      credentials: { clientSecret: 'secret' },
      settings,
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
        robotCode: 'robot-app', // fallback when raw.robotCode missing
      }),
    );
    expect(result?.files).toHaveLength(1);
    expect(result!.files![0].name).toBe('data.xlsx');
    expect(result!.files![0].buffer?.toString()).toBe('xlsx-bytes');
    expect(result!.files![0].persistToResourceLibrary).toBe(true);
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

  it('prefers raw.robotCode over applicationId for download', async () => {
    downloadDingTalkRobotFile.mockResolvedValue(Buffer.from('x'));
    const client = makeClient();
    await client.extractFiles!(
      makeFileMessage({
        content: { downloadCode: 'C', fileName: 'a.xlsx' },
        msgtype: 'file',
        robotCode: 'robot-from-callback',
      }),
    );
    expect(downloadDingTalkRobotFile).toHaveBeenCalledWith(
      expect.objectContaining({ robotCode: 'robot-from-callback' }),
    );
  });

  it('createAdapter returns DingTalkAdapter instance', () => {
    const client = makeClient();
    const adapters = client.createAdapter();
    expect(adapters.dingtalk).toBeDefined();
    expect(adapters.dingtalk.name).toBe('dingtalk');
  });
});

describe('DingTalkClient outbound capabilities', () => {
  beforeEach(() => {
    createDingTalkAICard.mockReset();
    updateDingTalkAICard.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('preserves Markdown instead of reducing replies to plain text', () => {
    expect(makeClient().formatMarkdown('**结论**\n\n- 建议')).toBe('**结论**\n\n- 建议');
  });

  it('enables editable progress only when an AI Card template is configured', () => {
    expect(makeClient().supportsMessageEdit).toBe(false);
    expect(makeClient({ aiCardTemplateId: 'tpl-1' }).supportsMessageEdit).toBe(true);
  });

  it('creates a native progress card for a direct conversation', async () => {
    createDingTalkAICard.mockResolvedValue('yidalab_card-1');
    const client = makeClient({ aiCardTemplateId: 'tpl-1' });

    await expect(
      client.createProgressMessage({
        content: '正在思考…',
        platformThreadId: 'dingtalk:1:cid-1',
        platformUserId: 'staff-1',
      }),
    ).resolves.toEqual({ id: 'yidalab_card-1' });
    expect(createDingTalkAICard).toHaveBeenCalledWith({
      config: {
        clientId: 'robot-app',
        clientSecret: 'secret',
        templateId: 'tpl-1',
      },
      content: '正在思考…',
      userId: 'staff-1',
    });
  });

  it('does not redirect a group response into a private AI Card', async () => {
    const client = makeClient({ aiCardTemplateId: 'tpl-1' });

    await expect(
      client.createProgressMessage({
        content: '正在思考…',
        platformThreadId: 'dingtalk:2:group-1',
        platformUserId: 'staff-1',
      }),
    ).resolves.toBeUndefined();
    expect(createDingTalkAICard).not.toHaveBeenCalled();
  });

  it('streams step updates and finalizes the same AI Card', async () => {
    const client = makeClient({ aiCardTemplateId: 'tpl-1' });
    const messenger = client.getMessenger('dingtalk:1:cid-1');

    await messenger.editMessage('yidalab_card-1', '调用工具中…');
    await messenger.completeMessage?.('yidalab_card-1', '最终答案');

    expect(updateDingTalkAICard).toHaveBeenNthCalledWith(1, {
      cardInstanceId: 'yidalab_card-1',
      config: {
        clientId: 'robot-app',
        clientSecret: 'secret',
        templateId: 'tpl-1',
      },
      content: '调用工具中…',
      finished: false,
    });
    expect(updateDingTalkAICard).toHaveBeenNthCalledWith(2, {
      cardInstanceId: 'yidalab_card-1',
      config: {
        clientId: 'robot-app',
        clientSecret: 'secret',
        templateId: 'tpl-1',
      },
      content: '最终答案',
      finished: true,
    });
  });
});
