import { describe, expect, it } from 'vitest';

import {
  appendBotDingpanPreviewLink,
  scrubFakeUploadProgressNarration,
  shouldEnsureDingpanForBotReply,
  wrapBotReplyAsHtml,
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
    expect(cleaned).toMatch(/uploadHtmlToDingpan|重复进度|重试/);
    expect(cleaned.length).toBeLessThan(body.length / 2);
  });

  it('collapses 日期改为 / 同时查询 planning loops', () => {
    const body =
      '领星限制90天,缩小范围查询。' +
      '日期改为2026-05-01至2026-07-30。同时查询关键词竞争格局。'.repeat(80);
    const cleaned = scrubFakeUploadProgressNarration(body);
    expect(cleaned.length).toBeLessThan(body.length / 5);
    expect((cleaned.match(/日期改为/g) ?? []).length).toBeLessThan(4);
  });
});

describe('wrapBotReplyAsHtml', () => {
  it('renders report Markdown as structured, responsive HTML', async () => {
    const html = await wrapBotReplyAsHtml(
      `## 核心结论

- 旺季峰值在 8 月
- 提前四周起量

| 指标 | 结果 |
| --- | ---: |
| 搜索量 | 12,800 |

![趋势图](https://cdn.example.com/trend.png)`,
      '加拿大开学季分析',
    );

    expect(html).toContain('<h2>核心结论</h2>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>指标</th>');
    expect(html).toContain('<img src="https://cdn.example.com/trend.png" alt="趋势图">');
    expect(html).toContain('@media(max-width:640px)');
    expect(html).not.toContain('| --- |');
  });

  it('does not execute raw HTML embedded in a model reply', async () => {
    const html = await wrapBotReplyAsHtml(
      '正常结论。\n\n<script>alert("unsafe")</script>',
      '安全报告',
    );

    expect(html).toContain('<p>正常结论。</p>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert("unsafe")');
  });
});
