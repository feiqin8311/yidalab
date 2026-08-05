import { describe, expect, it } from 'vitest';

import {
  inferAttachmentCapabilities,
  isDocumentAttachment,
  isSpreadsheetAttachment,
} from './attachmentCapabilities';

describe('attachmentCapabilities', () => {
  it('detects spreadsheet by extension and mime', () => {
    expect(isSpreadsheetAttachment(undefined, 'a.xlsx')).toBe(true);
    expect(isSpreadsheetAttachment('text/csv', 'data.csv')).toBe(true);
    expect(
      isSpreadsheetAttachment(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'x',
      ),
    ).toBe(true);
  });

  it('detects documents and not images', () => {
    expect(isDocumentAttachment('application/pdf', 'a.pdf')).toBe(true);
    expect(isDocumentAttachment('image/png', 'a.png')).toBe(false);
    expect(isDocumentAttachment(undefined, 'a.docx')).toBe(true);
  });

  it('gates capabilities per turn files', () => {
    expect(inferAttachmentCapabilities([])).toEqual({
      hasAttachment: false,
      hasDocument: false,
      hasSpreadsheet: false,
    });
    expect(inferAttachmentCapabilities([{ name: 'a.xlsx' }])).toEqual({
      hasAttachment: true,
      hasDocument: false,
      hasSpreadsheet: true,
    });
    expect(inferAttachmentCapabilities([{ name: 'a.docx' }])).toEqual({
      hasAttachment: true,
      hasDocument: true,
      hasSpreadsheet: false,
    });
    expect(inferAttachmentCapabilities([{ name: 'a.xlsx' }, { name: 'b.pdf' }])).toEqual({
      hasAttachment: true,
      hasDocument: true,
      hasSpreadsheet: true,
    });
  });
});
