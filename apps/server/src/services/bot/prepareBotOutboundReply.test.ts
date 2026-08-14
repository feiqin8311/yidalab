// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findDingpanUploadsByOperation,
  ensureDingpanDeliverable,
  shouldEnsureDingpanForBotReply,
  scrubFakeUploadProgressNarration,
  recordOutcome,
} = vi.hoisted(() => ({
  findDingpanUploadsByOperation: vi.fn(),
  ensureDingpanDeliverable: vi.fn(),
  shouldEnsureDingpanForBotReply: vi.fn(),
  scrubFakeUploadProgressNarration: vi.fn((s: string) => s),
  recordOutcome: vi.fn(),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    findDingpanUploadsByOperation = findDingpanUploadsByOperation;
  },
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    recordOutcome = recordOutcome;
  },
}));

vi.mock('./botDingpanDeliveryHeuristic', () => ({
  scrubFakeUploadProgressNarration: (...args: unknown[]) =>
    scrubFakeUploadProgressNarration(...(args as [string])),
  shouldEnsureDingpanForBotReply: (...args: unknown[]) => shouldEnsureDingpanForBotReply(...args),
}));

vi.mock('./ensureDingpanDeliverable', () => ({
  ensureDingpanDeliverable: (...args: unknown[]) => ensureDingpanDeliverable(...args),
}));

const { compactBotRelayText, prepareBotOutboundReply } = await import('./prepareBotOutboundReply');

describe('compactBotRelayText', () => {
  const url =
    'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=2&type=file';

  it('keeps short text', () => {
    expect(compactBotRelayText('旺季在8月')).toBe('旺季在8月');
  });

  it('unwraps markdown links', () => {
    expect(compactBotRelayText(`[打开](${url})`)).toContain(url);
    expect(compactBotRelayText(`[打开](${url})`)).not.toContain('](');
  });

  it('strips angle-bracket autolinks around dingpan urls', () => {
    const out = compactBotRelayText(`钉盘报告：\n<${url}>`);
    expect(out).toContain(url);
    expect(out).not.toContain(`<${url}>`);
    expect(out).not.toMatch(/<https?:/);
  });

  it('puts dingpan url after clipped conclusions', () => {
    const long = `${'结论要点。'.repeat(200)}\n${url}\n更多尾巴`;
    const out = compactBotRelayText(long, 200);
    expect(out).toContain(url);
    expect(out.length).toBeLessThan(long.length);
    expect(out.indexOf('结论')).toBeLessThan(out.indexOf(url));
  });
});

describe('prepareBotOutboundReply operation isolation', () => {
  const db = {} as any;
  const urlA =
    'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=opA&type=file';
  const urlB =
    'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=opB&type=file';

  beforeEach(() => {
    vi.clearAllMocks();
    scrubFakeUploadProgressNarration.mockImplementation((s: string) => s);
    shouldEnsureDingpanForBotReply.mockReturnValue(false);
    findDingpanUploadsByOperation.mockResolvedValue([]);
    ensureDingpanDeliverable.mockResolvedValue({ uploaded: false });
  });

  it('attaches only this operation upload, never topic history', async () => {
    findDingpanUploadsByOperation.mockResolvedValue([
      {
        apiName: 'uploadHtmlToDingpan',
        content: JSON.stringify({ preview_url: urlB, success: true }),
        identifier: 'lobe-dingpan',
      },
    ]);

    const out = await prepareBotOutboundReply({
      db,
      operationId: 'op_B',
      reply: '第二轮分析完成',
      topicId: 'tpc_1',
      userId: 'user_1',
    });

    expect(findDingpanUploadsByOperation).toHaveBeenCalledWith({
      operationId: 'op_B',
      topicId: 'tpc_1',
    });
    expect(out).toContain(urlB);
    expect(out).not.toContain(urlA);
    expect(ensureDingpanDeliverable).not.toHaveBeenCalled();
  });

  it('does not attach any historical link when this operation has no upload and is non-report', async () => {
    shouldEnsureDingpanForBotReply.mockReturnValue(false);
    findDingpanUploadsByOperation.mockResolvedValue([]);

    const out = await prepareBotOutboundReply({
      db,
      operationId: 'op_new',
      reply: '好的，已收到表格。',
      topicId: 'tpc_1',
      userId: 'user_1',
    });

    expect(out).toBe('好的，已收到表格。');
    expect(out).not.toMatch(/qr\.dingtalk\.com/);
    expect(ensureDingpanDeliverable).not.toHaveBeenCalled();
  });

  it('triggers system ensure only for this operation on report-class replies', async () => {
    shouldEnsureDingpanForBotReply.mockReturnValue(true);
    findDingpanUploadsByOperation.mockResolvedValue([]);
    ensureDingpanDeliverable.mockResolvedValue({
      previewUrl: urlA,
      uploaded: true,
    });

    const out = await prepareBotOutboundReply({
      assistantMessageId: 'asst_1',
      db,
      operationId: 'op_A',
      reply: '结论：销量上涨。建议继续投放。',
      topicId: 'tpc_1',
      userId: 'user_1',
    });

    expect(ensureDingpanDeliverable).toHaveBeenCalledWith(
      expect.objectContaining({
        turn: expect.objectContaining({
          assistantMessageId: 'asst_1',
          operationId: 'op_A',
          topicId: 'tpc_1',
        }),
      }),
    );
    expect(out).toContain(urlA);
  });

  it('removes a superseded upload failure claim when system fallback succeeds', async () => {
    shouldEnsureDingpanForBotReply.mockReturnValue(true);
    ensureDingpanDeliverable.mockResolvedValue({ previewUrl: urlA, uploaded: true });

    const out = await prepareBotOutboundReply({
      db,
      operationId: 'op_fallback_success',
      reply: '结论：销量上涨。\n本轮未能成功生成并上传 HTML 文件，因此没有可用的钉盘链接。',
      topicId: 'tpc_1',
      userId: 'user_1',
    });

    expect(out).toContain('结论：销量上涨。');
    expect(out).toContain(urlA);
    expect(out).not.toMatch(/未能成功生成并上传|没有可用的钉盘链接/);
  });

  it('never falls back to history when ensure fails', async () => {
    shouldEnsureDingpanForBotReply.mockReturnValue(true);
    findDingpanUploadsByOperation.mockResolvedValue([]);
    ensureDingpanDeliverable.mockResolvedValue({
      error: 'upload failed',
      uploaded: false,
    });

    const out = await prepareBotOutboundReply({
      db,
      operationId: 'op_fail',
      reply: '结论：报告。建议：重试。',
      topicId: 'tpc_1',
      userId: 'user_1',
    });

    expect(out).toMatch(/钉盘报告上传失败/);
    expect(out).toMatch(/分析结果已在当前会话完整返回/);
    expect(out).not.toMatch(/重试上传/);
    expect(out).not.toMatch(/Web/);
    expect(out).not.toMatch(/qr\.dingtalk\.com/);
  });

  it('without operationId never queries topic history for auto-attach', async () => {
    shouldEnsureDingpanForBotReply.mockReturnValue(false);

    const out = await prepareBotOutboundReply({
      db,
      reply: '普通回复',
      topicId: 'tpc_1',
      userId: 'user_1',
    });

    expect(findDingpanUploadsByOperation).not.toHaveBeenCalled();
    expect(out).toBe('普通回复');
  });

  it('strips historical dingpan URL pasted in assistant prose', async () => {
    shouldEnsureDingpanForBotReply.mockReturnValue(false);
    findDingpanUploadsByOperation.mockResolvedValue([]);

    const out = await prepareBotOutboundReply({
      db,
      operationId: 'op_new',
      reply: `第二轮结论。\n钉盘报告：\n${urlA}`,
      topicId: 'tpc_1',
      userId: 'user_1',
    });

    expect(out).not.toContain(urlA);
    expect(out).toMatch(/第二轮结论/);
  });

  it('preserves a full-length Markdown reply for channels that support it', async () => {
    const reply = `# 分析结论\n\n${'完整上下文和详细建议。'.repeat(180)}`;

    const out = await prepareBotOutboundReply({
      db,
      operationId: 'op_full',
      relayMode: 'full',
      reply,
      topicId: 'tpc_1',
      userId: 'user_1',
    });

    expect(out).toBe(reply);
    expect(out.length).toBeGreaterThan(1200);
  });
});
