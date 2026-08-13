import { describe, expect, it } from 'vitest';

import { buildJpegPdf, bytesToBase64 } from './buildJpegPdf';

// Minimal JPEG SOI + EOI. Enough to embed; viewers may not decode it.
const MINI_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe('buildJpegPdf', () => {
  it('builds a PDF that starts with the header and lists each page', () => {
    const pdf = buildJpegPdf([
      { height: 842, jpeg: MINI_JPEG, width: 595 },
      { height: 842, jpeg: MINI_JPEG, width: 595 },
    ]);

    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('%%EOF');
    expect(bytesToBase64(pdf).length).toBeGreaterThan(0);
  });

  it('rejects an empty page list', () => {
    expect(() => buildJpegPdf([])).toThrow('PDF has no pages');
  });
});
