import { describe, expect, it } from 'vitest';

import {
  buildExportFileName,
  displayKeyword,
  extractAsin,
  isExactAsin,
  normalizeKeywordKey,
  safeFileNamePart,
} from '../normalize';

describe('normalizeKeywordKey', () => {
  it('strips BOM zero-width and lowercases', () => {
    expect(normalizeKeywordKey('\uFEFFKids\u200B Scissors')).toBe('kids scissors');
  });

  it('normalizes ampersand and multi spaces', () => {
    expect(normalizeKeywordKey('A  &  B')).toBe('a and b');
  });
});

describe('asin', () => {
  it('detects exact ASIN only', () => {
    expect(isExactAsin('B0CH9V3V35')).toBe(true);
    expect(isExactAsin('b0ch9v3v35')).toBe(true);
    expect(isExactAsin('kids scissors B0CH9V3V35')).toBe(false);
  });

  it('extracts from targeting string', () => {
    expect(extractAsin('asin="B000UVMNF4"')).toBe('B000UVMNF4');
    expect(extractAsin('B0CH9V3V35')).toBe('B0CH9V3V35');
  });
});

describe('export name', () => {
  it('sanitizes category', () => {
    expect(safeFileNamePart('儿童/剪刀:测试')).toBe('儿童剪刀测试');
    expect(buildExportFileName('儿童剪刀', new Date('2026-07-29T06:30:12Z'))).toMatch(
      /^老品关键词全景经营诊断-儿童剪刀-\d{8}-\d{6}\.xlsx$/,
    );
  });

  it('display keeps casing lightly cleaned', () => {
    expect(displayKeyword('  Kids   Scissors  ')).toBe('Kids Scissors');
  });
});
