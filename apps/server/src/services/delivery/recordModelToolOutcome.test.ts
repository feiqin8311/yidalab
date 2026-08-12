// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueue, markSucceeded, markFailed, recordOutcome, tryClaim } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  markSucceeded: vi.fn(),
  markFailed: vi.fn(),
  recordOutcome: vi.fn(),
  tryClaim: vi.fn(),
}));

vi.mock('@/database/models/deliveryAttempt', () => ({
  DeliveryAttemptModel: class {
    enqueue = enqueue;
    markSucceeded = markSucceeded;
    markFailed = markFailed;
    tryClaim = tryClaim;
  },
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    recordOutcome = recordOutcome;
  },
}));

const { recordModelToolDingpanOutcome } = await import('./recordModelToolOutcome');

describe('recordModelToolDingpanOutcome', () => {
  const db = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    enqueue.mockResolvedValue({ id: 'dla_1', status: 'pending' });
    tryClaim.mockResolvedValue({ id: 'dla_1', status: 'running', attempt: 1 });
    markSucceeded.mockResolvedValue({ status: 'succeeded' });
    markFailed.mockResolvedValue({ status: 'failed' });
    recordOutcome.mockResolvedValue(true);
  });

  it('no-ops for non-dingpan tools', async () => {
    await recordModelToolDingpanOutcome({
      content: '{}',
      db,
      metadata: { operationId: 'op_1' },
      plugin: { apiName: 'other', identifier: 'lobe-other' },
      userId: 'u1',
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('marks verified when tool returns trusted preview_url', async () => {
    const previewUrl =
      'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=2&type=file';
    await recordModelToolDingpanOutcome({
      content: JSON.stringify({ preview_url: previewUrl, success: true, file_id: '2' }),
      db,
      metadata: { operationId: 'op_1', source: 'model-tool' },
      plugin: { apiName: 'uploadHtmlToDingpan', identifier: 'lobe-dingpan' },
      userId: 'u1',
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'op_1:dingpan-report:default:report',
        operationId: 'op_1',
      }),
    );
    expect(tryClaim).toHaveBeenCalled();
    expect(markSucceeded).toHaveBeenCalledWith(
      'dla_1',
      expect.objectContaining({
        claimToken: expect.any(String),
        previewUrl,
        verificationStatus: 'verified',
      }),
    );
    expect(recordOutcome).toHaveBeenCalledWith(
      'op_1',
      expect.objectContaining({ outcomeStatus: 'verified', outcomeType: 'dingpan' }),
    );
  });

  it('marks failed when tool returns success=false', async () => {
    await recordModelToolDingpanOutcome({
      content: JSON.stringify({ success: false, error: '403' }),
      db,
      metadata: { operationId: 'op_2' },
      plugin: { apiName: 'uploadHtmlToDingpan', identifier: 'lobe-dingpan' },
      userId: 'u1',
    });
    expect(markFailed).toHaveBeenCalledWith(
      'dla_1',
      expect.objectContaining({
        claimToken: expect.any(String),
        errorCode: 'model_tool_dingpan_failed',
        retryable: true,
      }),
    );
    expect(recordOutcome).toHaveBeenCalledWith(
      'op_2',
      expect.objectContaining({ outcomeStatus: 'failed' }),
    );
  });
});
