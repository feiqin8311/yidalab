import { parseMarkdown } from '@lobechat/utils/parseMarkdown';

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
  '本轮模型陷入重复进度/规划文案，未完成工具调用或报告上传。请缩小问题范围后重新发送。';

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

export const wrapBotReplyAsHtml = async (reply: string, title: string): Promise<string> => {
  // remark-html keeps raw model-authored HTML disabled while preserving GFM
  // structure such as headings, lists, tables, code blocks, links, and images.
  const body = await parseMarkdown(reply);
  const safeTitle = escapeHtml(title);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <title>${safeTitle}</title>
  <style>
    :root{--ink:#172033;--muted:#657086;--line:#dfe5ef;--paper:#fff;--canvas:#f3f6fa;--accent:#2457d6;--accent-soft:#edf3ff;--code:#111827}
    *{box-sizing:border-box}
    html{background:var(--canvas)}
    body{margin:0;color:var(--ink);background:var(--canvas);font-family:Geist,-apple-system,BlinkMacSystemFont,"Segoe UI Variable Display","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.72;-webkit-font-smoothing:antialiased}
    .report{width:min(100% - 32px,1040px);margin:32px auto 64px;background:var(--paper);border:1px solid var(--line);border-top:6px solid var(--accent);border-radius:12px;box-shadow:0 16px 48px rgba(23,32,51,.08)}
    .report-header{padding:32px 40px 28px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,var(--accent-soft),#fff 58%)}
    .report-kicker{margin:0 0 8px;color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
    .report-title{margin:0;font-size:clamp(26px,4vw,40px);line-height:1.18;letter-spacing:-.025em}
    .report-body{padding:32px 40px 48px;overflow-wrap:anywhere}
    .report-body>:first-child{margin-top:0}
    .report-body>:last-child{margin-bottom:0}
    h1,h2,h3,h4{margin:1.8em 0 .65em;line-height:1.3;letter-spacing:-.015em}
    h1{font-size:28px}h2{padding-bottom:10px;border-bottom:1px solid var(--line);font-size:23px}h3{font-size:19px}h4{font-size:16px}
    p,ul,ol,blockquote,pre,table{margin:0 0 20px}
    ul,ol{padding-left:1.5em}li+li{margin-top:7px}li>ul,li>ol{margin-top:7px;margin-bottom:8px}
    strong{font-weight:700;color:#0f172a}
    a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:3px}
    blockquote{margin-left:0;padding:14px 18px;border-left:4px solid var(--accent);border-radius:0 8px 8px 0;color:#445069;background:var(--accent-soft)}
    table{display:block;width:100%;overflow-x:auto;border-collapse:collapse;font-variant-numeric:tabular-nums}
    th,td{min-width:120px;padding:11px 14px;border:1px solid var(--line);text-align:left;vertical-align:top}
    th{color:#27324a;background:#f6f8fc;font-size:13px;font-weight:700;white-space:nowrap}
    tbody tr:nth-child(even){background:#fafbfe}
    pre{overflow-x:auto;padding:18px 20px;border-radius:8px;color:#e5e7eb;background:var(--code);line-height:1.55}
    code{font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}
    :not(pre)>code{padding:2px 6px;border:1px solid var(--line);border-radius:4px;color:#27324a;background:#f6f8fc}
    img{display:block;max-width:100%;height:auto;margin:24px auto;border:1px solid var(--line);border-radius:8px}
    hr{margin:32px 0;border:0;border-top:1px solid var(--line)}
    @media(max-width:640px){.report{width:100%;margin:0;border-width:0;border-top-width:5px;border-radius:0;box-shadow:none}.report-header,.report-body{padding:24px 20px}.report-title{font-size:28px}th,td{min-width:104px;padding:9px 10px}}
    @media print{html,body{background:#fff}.report{width:100%;margin:0;border:0;border-top:5px solid var(--accent);box-shadow:none}.report-header{padding:24px 0}.report-body{padding:28px 0}a{color:inherit}pre,blockquote,table,img{break-inside:avoid}}
  </style>
</head>
<body>
  <main class="report">
    <header class="report-header">
      <p class="report-kicker">YidaLab · 决策分析</p>
      <h1 class="report-title">${safeTitle}</h1>
    </header>
    <article class="report-body">${body}</article>
  </main>
</body>
</html>`;
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
