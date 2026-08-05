/** Keyword / ASIN normalization — pure rules from input-contract. */

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\uFFFC\u00AD\u2060\u180E]/g;
const MULTI_SPACE = /\s+/g;

export const ASIN_EXACT_RE = /^B0[A-Z0-9]{8}$/i;
export const ASIN_IN_TARGET_RE = /asin\s*=\s*"?(B0[A-Z0-9]{8})"?/i;

/** Unicode NFKC + strip BOM/zero-width + lower + light punctuation normalize. */
export const normalizeKeywordKey = (raw: string | null | undefined): string => {
  if (raw == null) return '';
  let s = String(raw).normalize('NFKC');
  s = s.replace(/^\uFEFF/, '').replaceAll(ZERO_WIDTH, '');
  s = s.toLowerCase();
  s = s.replaceAll('&', ' and ');
  s = s.replaceAll(/[“”«»„]/g, '"').replaceAll(/[‘’‚]/g, "'");
  s = s.replaceAll(/[‐‑‒–—―]/g, '-');
  s = s.replaceAll(/[\\/|]+/g, ' ');
  s = s.replaceAll(/[,;:]+/g, ' ');
  s = s.replaceAll(MULTI_SPACE, ' ').trim();
  return s;
};

export const displayKeyword = (raw: string | null | undefined): string => {
  if (raw == null) return '';
  return String(raw)
    .normalize('NFKC')
    .replace(/^\uFEFF/, '')
    .replaceAll(ZERO_WIDTH, '')
    .replaceAll(MULTI_SPACE, ' ')
    .trim();
};

export const isExactAsin = (raw: string | null | undefined): boolean => {
  const key = normalizeKeywordKey(raw).toUpperCase();
  return ASIN_EXACT_RE.test(key);
};

export const extractAsin = (raw: string | null | undefined): string | null => {
  if (raw == null) return null;
  const text = String(raw).normalize('NFKC').trim();
  const upper = text.toUpperCase();
  if (ASIN_EXACT_RE.test(upper)) return upper;
  const m = text.match(ASIN_IN_TARGET_RE);
  if (m?.[1]) return m[1].toUpperCase();
  return null;
};

export const safeFileNamePart = (name: string): string =>
  name
    .replaceAll(/[/\\:*?"<>|]/g, '')
    .replaceAll(/\s+/g, '')
    .trim() || '未命名';

/** Asia/Shanghai local YYYYMMDD-HHmmss. */
export const formatShanghaiTimestamp = (date: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
};

export const buildExportFileName = (categoryName: string, date: Date = new Date()): string =>
  `老品关键词全景经营诊断-${safeFileNamePart(categoryName)}-${formatShanghaiTimestamp(date)}.xlsx`;
