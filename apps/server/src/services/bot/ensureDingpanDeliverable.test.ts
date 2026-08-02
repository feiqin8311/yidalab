// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findRecentDingpanUploadsInTopic,
  getLastMainThreadSpineMessageId,
  create,
  findById,
  update,
  uploadHtmlToDingpan,
  shouldEnsureDingpanForBotReply,
  wrapBotReplyAsHtml,
  withVaultCredEnv,
  findByIdUser,
} = vi.hoisted(() => ({
  findRecentDingpanUploadsInTopic: vi.fn(),
  getLastMainThreadSpineMessageId: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  uploadHtmlToDingpan: vi.fn(),
  shouldEnsureDingpanForBotReply: vi.fn(),
  wrapBotReplyAsHtml: vi.fn(),
  withVaultCredEnv: vi.fn(),
  findByIdUser: vi.fn(),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    findRecentDingpanUploadsInTopic = findRecentDingpanUploadsInTopic;
    getLastMainThreadSpineMessageId = getLastMainThreadSpineMessageId;
    create = create;
    findById = findById;
    update = update;
  },
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { findById: findByIdUser },
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    createDocument = vi.fn();
    getDocumentById = vi.fn();
    updateDocument = vi.fn();
  },
}));

vi.mock('@/server/utils/withVaultCredEnv', () => ({
  withVaultCredEnv: (...args: unknown[]) => withVaultCredEnv(...args),
}));

vi.mock('./botDingpanDeliveryHeuristic', () => ({
  shouldEnsureDingpanForBotReply: (...args: unknown[]) => shouldEnsureDingpanForBotReply(...args),
  wrapBotReplyAsHtml: (...args: unknown[]) => wrapBotReplyAsHtml(...args),
}));

vi.mock('@lobechat/builtin-tool-dingpan/executionRuntime', () => ({
  DingpanExecutionRuntime: class {
    uploadHtmlToDingpan = uploadHtmlToDingpan;
  },
}));

const { ensureDingpanDeliverable } = await import('./ensureDingpanDeliverable');

describe('ensureDingpanDeliverable', () => {
  const db = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    shouldEnsureDingpanForBotReply.mockReturnValue(true);
    findRecentDingpanUploadsInTopic.mockResolvedValue([]);
    findByIdUser.mockResolvedValue({ username: 'kerden' });
    wrapBotReplyAsHtml.mockReturnValue('<html><body>report</body></html>');
    withVaultCredEnv.mockImplementation(async (_u: string, _db: unknown, fn: () => unknown) =>
      fn(),
    );
    getLastMainThreadSpineMessageId.mockResolvedValue('msg_assistant_1');
    findById.mockResolvedValue({ id: 'msg_assistant_1', tools: [] });
    create.mockResolvedValue({ id: 'msg_tool_1' });
    update.mockResolvedValue({ success: true });
  });

  it('returns early when reply is not report-class', async () => {
    shouldEnsureDingpanForBotReply.mockReturnValue(false);
    const result = await ensureDingpanDeliverable({
      db,
      reply: 'ok',
      topicId: 'tpc_1',
      userId: 'user_1',
    });
    expect(result).toEqual({ uploaded: false });
    expect(uploadHtmlToDingpan).not.toHaveBeenCalled();
  });

  it('reuses existing successful topic upload without re-upload', async () => {
    findRecentDingpanUploadsInTopic.mockResolvedValue([
      {
        apiName: 'uploadHtmlToDingpan',
        content: JSON.stringify({
          preview_url: 'https://qr.dingtalk.com/page/yunpan?fileId=old',
          success: true,
        }),
        identifier: 'lobe-dingpan',
      },
    ]);

    const result = await ensureDingpanDeliverable({
      db,
      reply: '结论：销量上涨。建议继续投放。',
      topicId: 'tpc_1',
      userId: 'user_1',
    });

    expect(result).toEqual({
      previewUrl: 'https://qr.dingtalk.com/page/yunpan?fileId=old',
      uploaded: false,
    });
    expect(uploadHtmlToDingpan).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('uploads and persists message-level tool Artifact with arguments.html', async () => {
    const previewUrl = 'https://qr.dingtalk.com/page/yunpan?fileId=new';
    uploadHtmlToDingpan.mockResolvedValue({
      content: JSON.stringify({
        file_id: 'new',
        name: 'Bot报告.html',
        preview_url: previewUrl,
        success: true,
      }),
      state: { fileId: 'new', name: 'Bot报告.html', previewUrl, success: true },
      success: true,
    });

    const result = await ensureDingpanDeliverable({
      db,
      reply: '结论：报告内容。\n建议：继续。',
      topicId: 'tpc_1',
      userId: 'user_1',
    });

    expect(result).toEqual({ previewUrl, uploaded: true });
    expect(uploadHtmlToDingpan).toHaveBeenCalledWith(
      expect.objectContaining({
        html: '<html><body>report</body></html>',
        taskType: 'Bot报告',
      }),
    );

    expect(create).toHaveBeenCalledTimes(1);
    const createArg = create.mock.calls[0][0];
    expect(createArg.role).toBe('tool');
    expect(createArg.parentId).toBe('msg_assistant_1');
    expect(createArg.topicId).toBe('tpc_1');
    expect(createArg.plugin.identifier).toBe('lobe-dingpan');
    expect(createArg.plugin.apiName).toBe('uploadHtmlToDingpan');
    expect(JSON.parse(createArg.plugin.arguments)).toMatchObject({
      html: '<html><body>report</body></html>',
      taskType: 'Bot报告',
    });
    expect(createArg.content).toContain(previewUrl);
    expect(createArg.metadata).toMatchObject({
      source: 'bot-system-dingpan',
      systemInjected: true,
    });

    expect(update).toHaveBeenCalledWith(
      'msg_assistant_1',
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            apiName: 'uploadHtmlToDingpan',
            id: createArg.tool_call_id,
            identifier: 'lobe-dingpan',
          }),
        ],
      }),
    );
  });

  it('still returns previewUrl when persist fails', async () => {
    const previewUrl = 'https://qr.dingtalk.com/page/yunpan?fileId=x';
    uploadHtmlToDingpan.mockResolvedValue({
      content: JSON.stringify({ preview_url: previewUrl, success: true }),
      success: true,
    });
    create.mockRejectedValue(new Error('db down'));

    const result = await ensureDingpanDeliverable({
      db,
      reply: '结论：x',
      topicId: 'tpc_1',
      userId: 'user_1',
    });

    expect(result).toEqual({ previewUrl, uploaded: true });
  });
});
