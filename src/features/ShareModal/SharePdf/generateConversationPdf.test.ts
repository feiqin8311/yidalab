import { describe, expect, it } from 'vitest';

import { getTokenPlainText } from './generateConversationPdf';

describe('getTokenPlainText', () => {
  it('prefers token.text when present', () => {
    expect(getTokenPlainText({ raw: '| A | B |', text: 'ignored when text exists' })).toBe(
      'ignored when text exists',
    );
  });

  it('falls back to token.raw for table-like tokens without text', () => {
    expect(
      getTokenPlainText({
        raw: '| A | B |\n| - | - |\n| 1 | 2 |\n\n',
      }),
    ).toBe('| A | B |\n| - | - |\n| 1 | 2 |');
  });

  it('returns empty string when both are missing', () => {
    expect(getTokenPlainText({})).toBe('');
  });
});
