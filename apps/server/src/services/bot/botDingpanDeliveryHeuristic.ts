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

const PURE_PROGRESS_FALLBACK =
  '分析数据已就绪，但本轮未成功调用 uploadHtmlToDingpan 上传 HTML 报告（仅输出了上传进度文案）。请重试，或在 Web 打开同一话题查看。';

const countProgressPhrases = (text: string) =>
  (text.match(/正在上传|上传中|正在生成 HTML|上传钉盘|uploadHtml/gi) ?? []).length;

/**
 * Strip fake "正在上传 HTML…" loops. Keep the first real conclusions block when present.
 */
export const scrubFakeUploadProgressNarration = (reply: string): string => {
  const text = reply.trim();
  if (!text) return text;

  const progressHits = countProgressPhrases(text);
  if (progressHits < 3 && text.length < 1500) return text;

  // Cut at the first progress-spam cascade (common failure mode).
  const cascadeIdx = text.search(
    /稍等上传|以下是 HTML|正在上传 HTML|报告已准备完毕|开始上传|上传中[。.]/,
  );
  // Keep any non-trivial prefix before the spam cascade starts.
  let head = cascadeIdx > 20 ? text.slice(0, cascadeIdx).trim() : text;

  head = head
    .replaceAll(/正在上传 HTML 报告\.{0,3}/g, '')
    .replaceAll(/上传中[。.]?/g, '')
    .replaceAll(/正在生成 HTML 报告[^\n。]{0,40}/g, '')
    .replaceAll(/生成完成，上传钉盘[。.]?/g, '')
    .replaceAll(/上传钉盘[。.]?/g, '')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();

  head = head
    .replaceAll(/正在上传[\s\S]*$/g, '')
    .replaceAll(/上传中[\s\S]*$/g, '')
    .trim();

  const hasSubstance =
    head.length >= 20 &&
    (REPORTISH_RE.test(head) || /结论|旺季|峰值|建议|投放|关键词|起量/.test(head));

  if (!hasSubstance) {
    return progressHits >= 3 ? PURE_PROGRESS_FALLBACK : text;
  }

  if (countProgressPhrases(head) >= 5) return PURE_PROGRESS_FALLBACK;

  return head;
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
    return `${reply.trim()}\n\n钉盘报告：\n${previewUrl}`;
  }
  return `${reply.trim()}\n\n[打开钉盘预览](${previewUrl})`;
};
