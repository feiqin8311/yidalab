const ASIN_RE = /^[A-Z0-9]{10}$/;

/** Trim + uppercase only — does not strip punctuation (strict validation). */
export const normalizeAsin = (raw: string): string => raw.trim().toUpperCase();

export const isValidAsin = (raw: string): boolean => ASIN_RE.test(normalizeAsin(raw));

export type ParseListResult<T> = {
  invalid: string[];
  items: T[];
  /** Unique tokens before cap (for overflow detection). */
  uniqueCount: number;
};

/** Parse ASINs without silent drop: reports invalid tokens; does not truncate. */
export const parseAsinList = (raw: unknown): ParseListResult<string> => {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,;，、]+/) : [];
  const items: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const asin = normalizeAsin(trimmed);
    if (!ASIN_RE.test(asin)) {
      invalid.push(trimmed);
      continue;
    }
    if (seen.has(asin)) continue;
    seen.add(asin);
    items.push(asin);
  }
  return { invalid, items, uniqueCount: items.length };
};

/** @deprecated prefer parseAsinList + zod refine; kept for non-strict callers */
export const normalizeAsinList = (raw: unknown, maxItems = 10): string[] => {
  const { items } = parseAsinList(raw);
  return items.slice(0, maxItems);
};

export const parseKeywordList = (raw: unknown): ParseListResult<string> => {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\n,;，、]+/) : [];
  const items: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const kw = item.trim().replaceAll(/\s+/g, ' ');
    if (!kw) continue;
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(kw);
  }
  return { invalid: [], items, uniqueCount: items.length };
};

/** @deprecated prefer parseKeywordList + zod refine */
export const normalizeKeywordList = (raw: unknown, maxItems = 50): string[] => {
  const { items } = parseKeywordList(raw);
  return items.slice(0, maxItems);
};

export const MARKETPLACES = [
  { label: 'US', labelKey: 'US', value: 'US' },
  { label: 'UK', labelKey: 'UK', value: 'UK' },
  { label: 'DE', labelKey: 'DE', value: 'DE' },
  { label: 'JP', labelKey: 'JP', value: 'JP' },
  { label: 'CA', labelKey: 'CA', value: 'CA' },
  { label: 'FR', labelKey: 'FR', value: 'FR' },
  { label: 'IT', labelKey: 'IT', value: 'IT' },
  { label: 'ES', labelKey: 'ES', value: 'ES' },
  { label: 'AU', labelKey: 'AU', value: 'AU' },
] as const;
