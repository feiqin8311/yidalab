import { describe, expect, it } from 'vitest';

import {
  appendBotDingpanPreviewLink,
  scrubFakeUploadProgressNarration,
  shouldEnsureDingpanForBotReply,
} from './botDingpanDeliveryHeuristic';

describe('shouldEnsureDingpanForBotReply', () => {
  it('skips short replies', () => {
    expect(shouldEnsureDingpanForBotReply('旺季在8月'.repeat(10))).toBe(false);
  });

  it('skips when dingpan url already present', () => {
    const body =
      'a'.repeat(600) +
      ' 旺季广告节奏\nhttps://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=2&type=file';
    expect(shouldEnsureDingpanForBotReply(body)).toBe(false);
  });

  it('matches long report-like ops answers', () => {
    const body =
      '柯鹏翔，以下是基于 SIF 数据对 CA 开学季产品的流量趋势分析和广告投放建议。\n'.repeat(20) +
      '旺季峰值在 8 月，关键词 eraser / math set 需要加广告。';
    expect(shouldEnsureDingpanForBotReply(body)).toBe(true);
  });
});

describe('appendBotDingpanPreviewLink', () => {
  const url =
    'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=2&type=file';

  it('appends plain url for IM', () => {
    expect(appendBotDingpanPreviewLink('结论', url, true)).toContain(url);
    expect(appendBotDingpanPreviewLink('结论', url, true)).toContain('钉盘报告');
  });

  it('is idempotent when url already present', () => {
    const once = appendBotDingpanPreviewLink('结论', url, true);
    expect(appendBotDingpanPreviewLink(once, url, true)).toBe(once);
  });
});

describe('scrubFakeUploadProgressNarration', () => {
  it('keeps short normal replies', () => {
    expect(scrubFakeUploadProgressNarration('旺季在8月，建议现在加广告。')).toContain('8月');
  });

  it('strips repeated 正在上传 loops and keeps conclusions', () => {
    const body =
      '橡皮类核心词旺季7-9月（峰值8月），需立即起量。' +
      '正在上传 HTML 报告...'.repeat(40) +
      '上传中。'.repeat(40);
    const cleaned = scrubFakeUploadProgressNarration(body);
    expect(cleaned).toContain('8月');
    expect(cleaned.match(/正在上传/g)?.length ?? 0).toBeLessThan(3);
  });

  it('replaces pure progress spam', () => {
    const body = '正在上传 HTML 报告...上传中。'.repeat(50);
    const cleaned = scrubFakeUploadProgressNarration(body);
    expect(cleaned).toContain('uploadHtmlToDingpan');
    expect(cleaned.length).toBeLessThan(body.length / 2);
  });
});
