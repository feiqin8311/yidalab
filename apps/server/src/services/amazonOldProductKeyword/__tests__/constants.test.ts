import { describe, expect, it } from 'vitest';

import { assertRoleFile, guessRoleFromFileName } from '../constants';

describe('assertRoleFile', () => {
  it('accepts html for product_html', () => {
    expect(() => assertRoleFile('product_html', '01-产品调研.html', 'text/html')).not.toThrow();
  });

  it('rejects xlsx for product_html', () => {
    expect(() => assertRoleFile('product_html', 'a.xlsx')).toThrow(/INVALID_ROLE_EXTENSION/);
  });

  it('rejects wrong mime', () => {
    expect(() => assertRoleFile('sp_search_terms_daily', 'a.xlsx', 'image/png')).toThrow(
      /INVALID_ROLE_MIME/,
    );
  });
});

describe('guessRoleFromFileName', () => {
  it('maps common names', () => {
    expect(guessRoleFromFileName('03-SP搜索词-近60天-每日.xlsx')).toBe('sp_search_terms_daily');
    expect(guessRoleFromFileName('B0CH_产品调研报告.html')).toBe('product_html');
    expect(guessRoleFromFileName('多ASIN反查.xlsx')).toBe('multi_asin');
  });
});
