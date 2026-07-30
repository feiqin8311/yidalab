import { describe, expect, it } from 'vitest';

import { buildToolExecutionResult } from '../toolExecutionResult';

describe('buildToolExecutionResult', () => {
  it('splits model / ui / telemetry and marks external trust', () => {
    const r = buildToolExecutionResult({
      coverage: { returnedRows: 2, scannedRows: 10, totalRows: 100 },
      data: {
        rows: [{ a: 1 }, { a: 2 }],
        truncated: false,
      },
      source: { fileId: 'file_1', fileVersion: 'workbook-v1', sheet: 'S1' },
      success: true,
      uiSummary: '2 rows',
    });

    expect(r.success).toBe(true);
    expect(r.modelView.trust.trustLevel).toBe('external');
    expect(r.modelView.trust.memoryPolicy).toBe('deny');
    expect(r.modelView.source?.fileId).toBe('file_1');
    expect(r.modelView.coverage?.returnedRows).toBe(2);
    expect(r.content).toBe(r.modelView.content);
    expect(r.uiView.summary).toBe('2 rows');
    expect(r.telemetryView.success).toBe(true);
    expect(r.telemetryView.preview.length).toBeGreaterThan(0);
  });

  it('caps model view', () => {
    const r = buildToolExecutionResult({
      modelMaxChars: 50,
      modelText: 'x'.repeat(200),
      success: true,
    });
    expect(r.modelView.truncated).toBe(true);
    expect(r.modelView.content.length).toBeLessThan(120);
  });
});
