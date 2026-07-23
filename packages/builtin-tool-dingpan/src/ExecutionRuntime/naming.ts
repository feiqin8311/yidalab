/**
 * YidaLab 钉盘交付命名（与 OpenClaw / 旧助理名无关）。
 *
 * 目录：默认根下按日建 `YYYY-MM-DD/`
 * HTML：`{ASIN|关键词|产品名}_{站点?}_{任务类型}_{用户名}_{YYYYMMDD}.html`
 *
 * 示例：B0GVDTV1J6_日本_推广复盘_柯鹏翔_20260723.html
 */

const ILLEGAL = /[/\\:*?"<>|\r\n\t]+/g;
const MULTI_US = /_+/g;

/** Asia/Shanghai calendar day for folder + filename stamp. */
export const shanghaiDateParts = (now: Date = new Date()): { compact: string; folder: string } => {
  const local = now.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
  // "2026-07-23 14:05:06"
  const folder = local.slice(0, 10);
  const compact = folder.replaceAll('-', '');
  return { compact, folder };
};

export const sanitizeFilenameSegment = (raw: string): string => {
  const s = raw
    .trim()
    .replaceAll(ILLEGAL, '_')
    .replaceAll(/\s+/g, '')
    .replaceAll(MULTI_US, '_')
    .replaceAll(/^_+|_+$/g, '');
  return s.slice(0, 80);
};

export interface HtmlDeliverableNameInput {
  /** Amazon ASIN, e.g. B0GVDTV1J6 */
  asin?: string;
  /** Calendar day override (defaults to Asia/Shanghai today). */
  date?: Date;
  /** Search keyword when ASIN unknown. */
  keyword?: string;
  /** Product title short name. */
  productName?: string;
  /** Market / site label, e.g. 日本 / JP / US */
  site?: string;
  /** Task short label, e.g. 推广复盘 */
  taskType?: string;
  /**
   * **Current human user** display name (not agent name).
   * Example: 柯鹏翔
   */
  userName?: string;
}

/**
 * Build remote HTML file name. Empty optional segments are skipped.
 * Always ends with `.html`.
 */
export const buildHtmlDeliverableName = (input: HtmlDeliverableNameInput): string => {
  const { compact } = shanghaiDateParts(input.date);
  const subject = [input.asin, input.site, input.keyword, input.productName]
    .map((v) => (v ? sanitizeFilenameSegment(v) : ''))
    .filter(Boolean);
  const rest = [input.taskType, input.userName]
    .map((v) => (v ? sanitizeFilenameSegment(v) : ''))
    .filter(Boolean);

  const parts = [...subject, ...rest, compact];
  if (parts.length === 1) {
    // only date — still identifiable
    return `report_${compact}.html`;
  }
  return `${parts.join('_')}.html`;
};
