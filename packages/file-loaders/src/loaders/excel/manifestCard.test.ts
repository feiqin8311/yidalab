import { describe, expect, it } from 'vitest';

import { buildWorkbookManifestCard, shouldInlineParsedText } from './manifestCard';
import type { WorkbookAssetBuild } from './workbookAsset';

const sample: WorkbookAssetBuild = {
  coverage: { columnsCapped: false, sheetsCapped: false, sourceSheetCount: 2 },
  parserVersion: 'workbook-v1',
  sheetCount: 2,
  sheets: [
    {
      columnCount: 2,
      columns: ['a', 'b'],
      jsonl: '',
      rowCount: 1000,
      sampleRows: [{ a: '1', b: '2' }],
      sheetIndex: 0,
      sheetName: 'Sheet1',
    },
    {
      columnCount: 1,
      columns: ['x'],
      jsonl: '',
      rowCount: 3,
      sampleRows: [{ x: 'z' }],
      sheetIndex: 1,
      sheetName: 'Sheet2',
    },
  ],
  totalJsonlBytes: 0,
  totalRows: 1003,
  unrestrictedTokenEstimate: 500_000,
};

describe('buildWorkbookManifestCard', () => {
  it('includes tool guidance and stays bounded', () => {
    const card = buildWorkbookManifestCard(sample, {
      fileId: 'file_1',
      fileName: 'big.xlsx',
      size: 5_000_000,
    });
    expect(card).toContain('fileId=file_1');
    expect(card).toContain('lobe-workbook');
    expect(card).toContain('Sheet1');
    expect(card.length).toBeLessThan(20_000);
  });
});

describe('shouldInlineParsedText', () => {
  it('rejects large content', () => {
    expect(
      shouldInlineParsedText({
        content: 'x'.repeat(50_000),
        size: 1000,
      }),
    ).toBe(false);
  });

  it('accepts small content', () => {
    expect(
      shouldInlineParsedText({
        content: 'hello world',
        size: 100,
      }),
    ).toBe(true);
  });
});
