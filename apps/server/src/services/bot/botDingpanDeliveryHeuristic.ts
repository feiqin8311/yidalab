const REPORTISH_RE =
  /旺季|广告|投放|关键词|类目|流量|节奏|架构|SKU|ASIN|报告|策略|竞品|搜索量|开学|back to school/i;

const hasDingpanUrl = (text: string) =>
  /qr\.dingtalk\.com|previewDentry|yunpan\?route=preview/i.test(text);

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Long structured answers that should have been a shareable HTML report. */
export const shouldEnsureDingpanForBotReply = (reply: string): boolean => {
  const text = reply.trim();
  if (text.length < 500) return false;
  if (hasDingpanUrl(text)) return false;
  return REPORTISH_RE.test(text);
};

export const wrapBotReplyAsHtml = (reply: string, title: string) => {
  const body = escapeHtml(reply).replaceAll('\n', '<br/>');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(title)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6;max-width:880px;margin:24px auto;padding:0 16px;color:#111}h1{font-size:1.25rem}</style></head><body><h1>${escapeHtml(title)}</h1><div>${body}</div></body></html>`;
};

export const appendBotDingpanPreviewLink = (
  reply: string,
  previewUrl: string,
  plainText: boolean,
) => {
  if (reply.includes(previewUrl)) return reply;
  if (plainText) {
    return `${reply.trim()}\n\n完整报告：\n${previewUrl}`;
  }
  return `${reply.trim()}\n\n[打开钉盘预览](${previewUrl})`;
};
