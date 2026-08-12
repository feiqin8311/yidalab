// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findDingpanUploadsByOperation,
  getLastMainThreadSpineMessageId,
  create,
  findById,
  update,
  uploadHtmlToDingpan,
  shouldEnsureDingpanForBotReply,
  wrapBotReplyAsHtml,
  withVaultCredEnv,
  findByIdUser,
  enqueue,
  findSuccessfulByOperation,
  tryClaim,
  markSucceeded,
  markFailed,
  findByDedupeKey,
  recordOutcome,
} = vi.hoisted(() => ({
  findDingpanUploadsByOperation: vi.fn(),
  getLastMainThreadSpineMessageId: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  uploadHtmlToDingpan: vi.fn(),
  shouldEnsureDingpanForBotReply: vi.fn(),
  wrapBotReplyAsHtml: vi.fn(),
  withVaultCredEnv: vi.fn(),
  findByIdUser: vi.fn(),
  enqueue: vi.fn(),
  findSuccessfulByOperation: vi.fn(),
  tryClaim: vi.fn(),
  markSucceeded: vi.fn(),
  markFailed: vi.fn(),
  findByDedupeKey: vi.fn(),
  recordOutcome: vi.fn(),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    findDingpanUploadsByOperation = findDingpanUploadsByOperation;
    getLastMainThreadSpineMessageId = getLastMainThreadSpineMessageId;
    create = create;
    findById = findById;
    update = update;
  },
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { findById: findByIdUser },
}));

vi.mock('@/database/models/deliveryAttempt', () => ({
  DeliveryAttemptModel: class {
    enqueue = enqueue;
    findSuccessfulByOperation = findSuccessfulByOperation;
    tryClaim = tryClaim;
    markSucceeded = markSucceeded;
    markFailed = markFailed;
    findByDedupeKey = findByDedupeKey;
  },
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    recordOutcome = recordOutcome;
  },
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

const pendingAttempt = (id = 'dla_1') => ({
  attempt: 0,
  id,
  previewUrl: null,
  status: 'pending' as const,
});

describe('ensureDingpanDeliverable', () => {
  const db = {} as any;
  const turn = {
    assistantMessageId: 'msg_assistant_1',
    operationId: 'op_1',
    topicId: 'tpc_1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    shouldEnsureDingpanForBotReply.mockReturnValue(true);
    findDingpanUploadsByOperation.mockResolvedValue([]);
    findSuccessfulByOperation.mockResolvedValue(null);
    findByIdUser.mockResolvedValue({ username: 'kerden' });
    wrapBotReplyAsHtml.mockReturnValue('<html><body>report</body></html>');
    withVaultCredEnv.mockImplementation(async (_u: string, _db: unknown, fn: () => unknown) =>
      fn(),
    );
    getLastMainThreadSpineMessageId.mockResolvedValue('msg_assistant_1');
    findById.mockResolvedValue({ id: 'msg_assistant_1', tools: [] });
    create.mockResolvedValue({ id: 'msg_tool_1' });
    update.mockResolvedValue({ success: true });
    enqueue.mockResolvedValue(pendingAttempt());
    tryClaim.mockImplementation(async (id: string) => ({
      ...pendingAttempt(id),
      attempt: 1,
      status: 'running',
    }));
    markSucceeded.mockResolvedValue({ status: 'succeeded' });
    markFailed.mockResolvedValue({ status: 'failed' });
    recordOutcome.mockResolvedValue(undefined);
  });

  it('returns early when reply is not report-class', async () => {
    shouldEnsureDingpanForBotReply.mockReturnValue(false);
    const result = await ensureDingpanDeliverable({
      db,
      reply: 'ok',
      turn,
      userId: 'user_1',
    });
    expect(result).toEqual({ uploaded: false });
    expect(uploadHtmlToDingpan).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns early without operationId (no topic history fallback)', async () => {
    const result = await ensureDingpanDeliverable({
      db,
      reply: '结论：销量上涨。',
      topicId: 'tpc_1',
      userId: 'user_1',
    });
    expect(result).toEqual({ uploaded: false });
    expect(findDingpanUploadsByOperation).not.toHaveBeenCalled();
    expect(uploadHtmlToDingpan).not.toHaveBeenCalled();
  });

  it('reuses outbox succeeded row without re-upload', async () => {
    const previewUrl =
      'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=outbox&type=file';
    enqueue.mockResolvedValue({
      artifactId: null,
      id: 'dla_1',
      previewUrl,
      status: 'succeeded',
    });

    const result = await ensureDingpanDeliverable({
      db,
      reply: '结论：销量上涨。建议继续投放。',
      turn,
      userId: 'user_1',
    });

    expect(result).toMatchObject({
      deliveryAttemptId: 'dla_1',
      previewUrl,
      uploaded: false,
      verificationStatus: 'verified',
    });
    expect(uploadHtmlToDingpan).not.toHaveBeenCalled();
    expect(recordOutcome).toHaveBeenCalledWith(
      'op_1',
      expect.objectContaining({ outcomeStatus: 'verified', outcomeType: 'dingpan' }),
    );
  });

  it('reuses existing successful tool upload for the same operation only', async () => {
    const previewUrl =
      'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=same-op&type=file';
    findDingpanUploadsByOperation.mockResolvedValue([
      {
        apiName: 'uploadHtmlToDingpan',
        content: JSON.stringify({
          preview_url: previewUrl,
          success: true,
        }),
        identifier: 'lobe-dingpan',
      },
    ]);

    const result = await ensureDingpanDeliverable({
      db,
      reply: '结论：销量上涨。建议继续投放。',
      turn,
      userId: 'user_1',
    });

    expect(result).toMatchObject({
      deliveryAttemptId: 'dla_1',
      previewUrl,
      uploaded: false,
      verificationStatus: 'verified',
    });
    expect(findDingpanUploadsByOperation).toHaveBeenCalledWith({
      operationId: 'op_1',
      topicId: 'tpc_1',
    });
    expect(uploadHtmlToDingpan).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(tryClaim).toHaveBeenCalled();
    expect(markSucceeded).toHaveBeenCalledWith(
      'dla_1',
      expect.objectContaining({
        claimToken: expect.any(String),
        previewUrl,
        verificationStatus: 'verified',
      }),
    );
  });

  it('returns pending without outcome when close-claim CAS fails on existing tool preview', async () => {
    const previewUrl =
      'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=same-op&type=file';
    findDingpanUploadsByOperation.mockResolvedValue([
      {
        apiName: 'uploadHtmlToDingpan',
        content: JSON.stringify({ preview_url: previewUrl, success: true }),
        identifier: 'lobe-dingpan',
      },
    ]);
    tryClaim.mockResolvedValue(null);
    findByDedupeKey.mockResolvedValue({ id: 'dla_1', status: 'running', previewUrl: null });

    const result = await ensureDingpanDeliverable({
      db,
      reply: '结论：销量上涨。建议继续投放。',
      turn,
      userId: 'user_1',
    });

    expect(result).toMatchObject({
      deliveryAttemptId: 'dla_1',
      previewUrl,
      uploaded: false,
      verificationStatus: 'pending',
    });
    expect(markSucceeded).not.toHaveBeenCalled();
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it('returns pending when markSucceeded CAS fails after close-claim', async () => {
    const previewUrl =
      'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=same-op&type=file';
    findDingpanUploadsByOperation.mockResolvedValue([
      {
        apiName: 'uploadHtmlToDingpan',
        content: JSON.stringify({ preview_url: previewUrl, success: true }),
        identifier: 'lobe-dingpan',
      },
    ]);
    markSucceeded.mockResolvedValue(null);

    const result = await ensureDingpanDeliverable({
      db,
      reply: '结论：销量上涨。建议继续投放。',
      turn,
      userId: 'user_1',
    });

    expect(result).toMatchObject({
      verificationStatus: 'pending',
      uploaded: false,
      previewUrl,
    });
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it('uploads and persists message-level tool Artifact with operationId', async () => {
    const previewUrl =
      'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=new&type=file';
    uploadHtmlToDingpan.mockResolvedValue({
      content: JSON.stringify({
        file_id: 'new',
        name: 'Bot报告.html',
        preview_url: previewUrl,
        space_id: '1',
        success: true,
      }),
      state: { fileId: 'new', name: 'Bot报告.html', previewUrl, success: true },
      success: true,
    });

    const result = await ensureDingpanDeliverable({
      db,
      reply: '结论：报告内容。\n建议：继续。',
      turn,
      userId: 'user_1',
    });

    expect(result).toMatchObject({
      deliveryAttemptId: 'dla_1',
      previewUrl,
      uploaded: true,
      verificationStatus: 'verified',
    });
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
      deliveryType: 'dingpan-report',
      operationId: 'op_1',
      source: 'system-fallback',
      systemInjected: true,
    });
    expect(getLastMainThreadSpineMessageId).not.toHaveBeenCalled();

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
    expect(markSucceeded).toHaveBeenCalledWith(
      'dla_1',
      expect.objectContaining({
        claimToken: expect.any(String),
        fileId: 'new',
        previewUrl,
        verificationStatus: 'verified',
      }),
    );
    expect(recordOutcome).toHaveBeenCalledWith(
      'op_1',
      expect.objectContaining({ outcomeStatus: 'verified', outcomePreviewUrl: previewUrl }),
    );
  });

  it('still returns previewUrl when persist fails', async () => {
    const previewUrl =
      'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=x&type=file';
    uploadHtmlToDingpan.mockResolvedValue({
      content: JSON.stringify({
        preview_url: previewUrl,
        success: true,
        space_id: '1',
        file_id: 'x',
      }),
      success: true,
    });
    create.mockRejectedValue(new Error('db down'));

    const result = await ensureDingpanDeliverable({
      db,
      reply: '结论：x',
      turn,
      userId: 'user_1',
    });

    expect(result).toMatchObject({ previewUrl, uploaded: true, verificationStatus: 'verified' });
  });

  it('marks outbox failed when upload fails', async () => {
    uploadHtmlToDingpan.mockResolvedValue({
      content: 'permission denied',
      success: false,
    });

    const result = await ensureDingpanDeliverable({
      db,
      reply: '结论：报告',
      turn,
      userId: 'user_1',
    });

    expect(result).toMatchObject({
      uploaded: false,
      verificationStatus: 'failed',
    });
    expect(markFailed).toHaveBeenCalledWith(
      'dla_1',
      expect.objectContaining({ errorCode: 'dingpan_upload_failed', retryable: true }),
    );
    expect(recordOutcome).toHaveBeenCalledWith(
      'op_1',
      expect.objectContaining({ outcomeStatus: 'failed' }),
    );
  });
});
