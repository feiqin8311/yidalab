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
  '本轮模型陷入重复进度/规划文案（未完成工具调用或未上传报告）。请重试，或到 Web 打开同一话题查看中间结果。';

/** Upload fake progress */
const UPLOAD_PROGRESS_RE = /正在上传|上传中|正在生成 HTML|上传钉盘|uploadHtml/i;
/** Tool-planning loops (e.g. "日期改为…同时查询…" repeated hundreds of times) */
const TOOL_PLAN_NARRATION_RE =
  /日期改为|缩小范围|同时查询|查询竞争|判断头部|领星限制|最多查询|90\s*天|单次最多/;

const countMatches = (text: string, re: RegExp) =>
  (text.match(new RegExp(re.source, 'gi')) ?? []).length;

/**
 * Collapse when the same short sentence is repeated many times (generic loop detector).
 */
export const collapseRepeatedSentences = (reply: string): string => {
  const text = reply.trim();
  if (text.length < 200) return text;

  const parts = text
    .split(/(?<=[。！？\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 6) return text;

  const freq = new Map<string, number>();
  for (const p of parts) {
    const key = p.replaceAll(/\s+/g, ' ').slice(0, 80);
    if (key.length < 8) continue;
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }

  const maxRepeat = Math.max(0, ...freq.values());
  if (maxRepeat < 4) return text;

  const kept: string[] = [];
  const seen = new Map<string, number>();
  for (const p of parts) {
    const key = p.replaceAll(/\s+/g, ' ').slice(0, 80);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    // Keep first 2 occurrences of any sentence; drop further clones
    if (n <= 2) kept.push(p);
  }

  const cleaned = kept
    .join('')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
  if (cleaned.length < 40 && maxRepeat >= 4) return PURE_PROGRESS_FALLBACK;
  return cleaned || text;
};

/**
 * Strip fake progress / planning loops. Keep real conclusions when present.
 */
export const scrubFakeUploadProgressNarration = (reply: string): string => {
  let text = reply.trim();
  if (!text) return text;

  // 1) Generic sentence-repeat collapse (covers 日期改为… 同时查询… spam)
  text = collapseRepeatedSentences(text);

  const uploadHits = countMatches(text, UPLOAD_PROGRESS_RE);
  const planHits = countMatches(text, TOOL_PLAN_NARRATION_RE);

  if (uploadHits < 3 && planHits < 4 && text.length < 1500) return text;

  // 2) Cut at first upload-progress cascade
  const cascadeIdx = text.search(
    /稍等上传|以下是 HTML|正在上传 HTML|报告已准备完毕|开始上传|上传中[。.]|日期改为.{0,40}日期改为/,
  );
  let head = cascadeIdx > 20 ? text.slice(0, cascadeIdx).trim() : text;

  head = head
    .replaceAll(/正在上传 HTML 报告\.{0,3}/g, '')
    .replaceAll(/上传中[。.]?/g, '')
    .replaceAll(/正在生成 HTML 报告[^\n。]{0,40}/g, '')
    .replaceAll(/生成完成，上传钉盘[。.]?/g, '')
    .replaceAll(/(?:日期改为\d{4}-\d{2}-\d{2}至\d{4}-\d{2}-\d{2}[。.]?\s*){2,}/g, '')
    .replaceAll(/(?:同时查询关键词竞争格局[^\n。]{0,30}[。.]?\s*){2,}/g, '')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();

  head = head
    .replaceAll(/正在上传[\s\S]*$/g, '')
    .replaceAll(/上传中[\s\S]*$/g, '')
    .trim();

  // Re-collapse after regex cleanup
  head = collapseRepeatedSentences(head);

  const hasSubstance =
    head.length >= 20 &&
    (REPORTISH_RE.test(head) || /结论|旺季|峰值|建议|投放|关键词|起量/.test(head));

  if (!hasSubstance) {
    return uploadHits >= 3 || planHits >= 4 ? PURE_PROGRESS_FALLBACK : text;
  }

  if (
    countMatches(head, UPLOAD_PROGRESS_RE) >= 5 ||
    countMatches(head, TOOL_PLAN_NARRATION_RE) >= 8
  ) {
    return PURE_PROGRESS_FALLBACK;
  }

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
