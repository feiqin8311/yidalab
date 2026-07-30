import { describe, expect, it } from 'vitest';

import {
  applyDingpanDeliveryClaimGuard,
  extractDingpanUploadOutcomes,
  normalizeEmptyToolContent,
} from './deliveryClaimGuard';

describe('normalizeEmptyToolContent', () => {
  it('keeps non-empty content', () => {
    expect(normalizeEmptyToolContent('ok')).toBe('ok');
  });

  it('synthesizes failure JSON for empty content', () => {
    const out = JSON.parse(normalizeEmptyToolContent('', { message: 'timeout' }));
    expect(out).toMatchObject({ success: false, error: 'timeout', synthetic: true });
  });
});

describe('extractDingpanUploadOutcomes', () => {
  it('parses success preview_url', () => {
    const outcomes = extractDingpanUploadOutcomes([
      {
        content: JSON.stringify({
          preview_url:
            'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=2&type=file',
          success: true,
        }),
        plugin: { apiName: 'uploadHtmlToDingpan', identifier: 'lobe-dingpan' },
        role: 'tool',
      },
    ]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].success).toBe(true);
    expect(outcomes[0].previewUrl).toContain('qr.dingtalk.com');
  });

  it('treats empty tool content as failure', () => {
    const outcomes = extractDingpanUploadOutcomes([
      {
        content: '',
        plugin: { apiName: 'uploadHtmlToDingpan', identifier: 'lobe-dingpan' },
        role: 'tool',
      },
    ]);
    expect(outcomes[0]).toMatchObject({ success: false });
  });
});

describe('applyDingpanDeliveryClaimGuard', () => {
  const preview =
    'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=28859011990&fileId=229849619551&type=file';

  it('is a no-op without dingpan tool messages', () => {
    expect(applyDingpanDeliveryClaimGuard('hello', [])).toBe('hello');
  });

  it('appends preview_url when tool succeeded even without 钉盘 claim', () => {
    const messages = [
      {
        content: JSON.stringify({ preview_url: preview, success: true }),
        plugin: { apiName: 'uploadHtmlToDingpan', identifier: 'lobe-dingpan' },
        role: 'tool' as const,
      },
    ];
    const content = '以下是核心结论：\n\n1. 旺季在 8 月';
    const guarded = applyDingpanDeliveryClaimGuard(content, messages);
    expect(guarded).toContain(preview);
    expect(guarded).toContain('以下是核心结论');
  });

  it('rewrites fake sif link when tool succeeded', () => {
    const messages = [
      {
        content: JSON.stringify({ preview_url: preview, success: true }),
        plugin: { apiName: 'uploadHtmlToDingpan', identifier: 'lobe-dingpan' },
        role: 'tool' as const,
      },
    ];
    const content =
      'HTML 报告已生成并上传至钉盘：\n\n[打开 HTML 复盘报告](https://www.sif.com/timemachine-traffic?asin=B0)';
    const guarded = applyDingpanDeliveryClaimGuard(content, messages);
    expect(guarded).toContain(preview);
    expect(guarded).not.toContain('sif.com');
  });

  it('replaces false success claim when tool failed', () => {
    const messages = [
      {
        content: '',
        plugin: { apiName: 'uploadHtmlToDingpan', identifier: 'lobe-dingpan' },
        role: 'tool' as const,
      },
    ];
    const guarded = applyDingpanDeliveryClaimGuard(
      'HTML 报告已生成并上传至钉盘：\n\n[打开](https://www.sif.com/x)',
      messages,
    );
    expect(guarded).toContain('钉盘上传失败');
    expect(guarded).not.toContain('sif.com');
  });
});
