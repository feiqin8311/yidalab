import { describe, expect, it } from 'vitest';

import { BUSINESS_FUNCTIONS, getEnabledBusinessFunctions } from './registry';

describe('business function registry', () => {
  it('exposes 9 enabled entries (7 ops + 2 legacy)', () => {
    const enabled = getEnabledBusinessFunctions();
    expect(enabled).toHaveLength(9);
    expect(enabled.every((f) => f.enabled)).toBe(true);
    expect(enabled.some((f) => f.id === 'lingxing-ads')).toBe(true);
    expect(enabled.some((f) => f.id === 'amazon-old-product-keyword-analysis')).toBe(true);
    expect(enabled.some((f) => f.id === 'asin-traffic-diagnosis')).toBe(true);
    expect(enabled.every((f) => f.path.startsWith('/functions'))).toBe(true);
    expect(new Set(enabled.map((f) => f.id)).size).toBe(9);
  });

  it('does not include unfinished placeholders', () => {
    expect(BUSINESS_FUNCTIONS.every((f) => f.enabled)).toBe(true);
  });
});
