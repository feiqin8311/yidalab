import { describe, expect, it } from 'vitest';

import { BUSINESS_FUNCTIONS, getEnabledBusinessFunctions } from './registry';

describe('business function registry', () => {
  it('only exposes enabled functions', () => {
    const enabled = getEnabledBusinessFunctions();
    expect(enabled.every((f) => f.enabled)).toBe(true);
    expect(enabled.some((f) => f.id === 'lingxing-ads')).toBe(true);
    expect(enabled.some((f) => f.id === 'amazon-old-product-keyword-analysis')).toBe(true);
    expect(enabled.every((f) => f.path.startsWith('/functions'))).toBe(true);
  });

  it('does not include unfinished placeholders', () => {
    expect(BUSINESS_FUNCTIONS.every((f) => f.enabled)).toBe(true);
  });
});
