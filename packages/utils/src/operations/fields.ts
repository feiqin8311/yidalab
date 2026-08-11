import { z } from 'zod';

import {
  isValidAsin,
  MARKETPLACES,
  normalizeAsin,
  parseAsinList,
  parseKeywordList,
} from './normalize';
import type { OperationsFieldDef } from './types';

export const marketplaceField = (opts?: Partial<OperationsFieldDef>): OperationsFieldDef => ({
  key: 'marketplace',
  label: 'Marketplace',
  options: MARKETPLACES.map((m) => ({
    label: m.label,
    labelKey: `marketplace.${m.labelKey}`,
    value: m.value,
  })),
  defaultValue: 'US',
  required: true,
  type: 'marketplace',
  ...opts,
});

export const asinField = (opts?: Partial<OperationsFieldDef>): OperationsFieldDef => ({
  key: 'asin',
  label: 'ASIN',
  placeholder: 'B0XXXXXXXX',
  placeholderKey: 'asin',
  required: true,
  type: 'asin',
  ...opts,
});

export const asinListField = (opts?: Partial<OperationsFieldDef>): OperationsFieldDef => ({
  key: 'asins',
  label: 'ASIN list',
  maxItems: 10,
  placeholder: 'One ASIN per line, max 10',
  placeholderKey: 'asinList',
  required: true,
  type: 'asinList',
  ...opts,
});

export const dateRangeField = (opts?: Partial<OperationsFieldDef>): OperationsFieldDef => ({
  key: 'dateRange',
  label: '时间范围',
  required: true,
  type: 'dateRange',
  ...opts,
});

export const keywordListField = (opts?: Partial<OperationsFieldDef>): OperationsFieldDef => ({
  key: 'keywords',
  label: 'Keywords',
  maxItems: 50,
  placeholder: 'One keyword per line',
  placeholderKey: 'keywordList',
  required: false,
  type: 'keywordList',
  ...opts,
});

export const textField = (
  key: string,
  label: string,
  opts?: Partial<OperationsFieldDef>,
): OperationsFieldDef => ({
  key,
  label,
  type: 'text',
  ...opts,
});

export const textareaField = (
  key: string,
  label: string,
  opts?: Partial<OperationsFieldDef>,
): OperationsFieldDef => ({
  key,
  label,
  type: 'textarea',
  ...opts,
});

export const dateField = (
  key: string,
  label: string,
  opts?: Partial<OperationsFieldDef>,
): OperationsFieldDef => ({
  key,
  label,
  type: 'date',
  ...opts,
});

export const selectField = (
  key: string,
  label: string,
  options: Array<{ label: string; labelKey?: string; value: string }>,
  opts?: Partial<OperationsFieldDef>,
): OperationsFieldDef => ({
  key,
  label,
  options: options.map((o) => ({
    ...o,
    labelKey: o.labelKey ?? `options.${key}.${o.value}`,
  })),
  type: 'select',
  ...opts,
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (s: string) => {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const MARKETPLACE_VALUES = new Set(MARKETPLACES.map((m) => m.value));

const dateRangeSchema = z
  .object({
    end: z.string().min(1),
    start: z.string().min(1),
  })
  .refine((v) => isIsoDate(v.start) && isIsoDate(v.end), {
    message: 'dates must be YYYY-MM-DD',
  })
  .refine((v) => v.start <= v.end, { message: 'start must be <= end' });

export const zodMarketplace = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => MARKETPLACE_VALUES.has(v as any), { message: 'Unsupported marketplace' });

export const zodAsin = z
  .string()
  .trim()
  .transform(normalizeAsin)
  .refine(isValidAsin, { message: 'Invalid ASIN' });

export const zodAsinList = (maxItems = 10, minItems = 1) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? [] : v),
    z
      .union([z.array(z.string()), z.string()])
      .superRefine((v, ctx) => {
        const parsed = parseAsinList(v);
        if (parsed.invalid.length) {
          ctx.addIssue({
            code: 'custom',
            message: `Invalid ASIN(s): ${parsed.invalid.slice(0, 5).join(', ')}`,
          });
        }
        if (parsed.uniqueCount > maxItems) {
          ctx.addIssue({
            code: 'custom',
            message: `At most ${maxItems} ASINs (got ${parsed.uniqueCount})`,
          });
        }
        if (parsed.items.length < minItems) {
          ctx.addIssue({
            code: 'custom',
            message: `At least ${minItems} ASIN(s) required`,
          });
        }
      })
      .transform((v) => parseAsinList(v).items),
  );

export const zodKeywordList = (maxItems = 50, minItems = 0) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? [] : v),
    z
      .union([z.array(z.string()), z.string()])
      .superRefine((v, ctx) => {
        const parsed = parseKeywordList(v);
        if (parsed.uniqueCount > maxItems) {
          ctx.addIssue({
            code: 'custom',
            message: `At most ${maxItems} keywords (got ${parsed.uniqueCount})`,
          });
        }
        if (parsed.items.length < minItems) {
          ctx.addIssue({
            code: 'custom',
            message: `At least ${minItems} keyword(s)`,
          });
        }
      })
      .transform((v) => parseKeywordList(v).items),
  );
export const zodDateRange = dateRangeSchema;
export const zodOptionalText = z.string().trim().max(2000).optional().or(z.literal(''));
