import { describe, expect, it } from 'vitest';

import { extractOpsHtmlArtifact } from './artifact';
import {
  ALL_OPERATIONS_MODES,
  getOperationsMode,
  OPERATIONS_FUNCTIONS,
  OPERATIONS_MODE_COUNT,
} from './modes';
import { normalizeAsinList, normalizeKeywordList } from './normalize';
import { evaluateOperationsPreflight } from './preflight';

describe('operations registry', () => {
  it('has 7 functions and 22 unique modes', () => {
    expect(OPERATIONS_FUNCTIONS).toHaveLength(7);
    expect(OPERATIONS_MODE_COUNT).toBe(22);
    const ids = ALL_OPERATIONS_MODES.map((m) => m.id);
    expect(new Set(ids).size).toBe(22);
    for (const fn of OPERATIONS_FUNCTIONS) {
      expect(fn.path.startsWith('/functions/')).toBe(true);
      expect(fn.modes.length).toBeGreaterThan(0);
      for (const m of fn.modes) {
        expect(m.functionId).toBe(fn.id);
        expect(m.fields.length).toBeGreaterThan(0);
        expect(m.reportSections.length).toBeGreaterThan(0);
        expect(m.buildPrompt({ marketplace: 'US' })).toContain('lobeArtifact');
      }
    }
  });

  it('listing modes accept empty advanced char fields', () => {
    for (const id of ['listing-full-audit', 'listing-rufus-rewrite', 'listing-intent-gap']) {
      const mode = getOperationsMode(id)!;
      const ok = mode.inputSchema.safeParse({
        marketplace: 'US',
        inputPath: 'existing',
        asin: 'B0ABCDEF12',
        titleMaxChars: '',
        bulletMaxChars: '',
        competitorAsins: '',
        keywords: '',
      });
      expect(ok.success, id).toBe(true);
    }
  });

  it('all 22 modes have unique ids and non-empty fields/schemas', () => {
    const ids = ALL_OPERATIONS_MODES.map((m) => m.id);
    expect(new Set(ids).size).toBe(22);
    for (const m of ALL_OPERATIONS_MODES) {
      expect(m.inputSchema).toBeTruthy();
      expect(m.fields.length).toBeGreaterThan(0);
    }
  });

  it('validates traffic single-asin params', () => {
    const mode = getOperationsMode('traffic-single-asin')!;
    const ok = mode.inputSchema.safeParse({
      marketplace: 'us',
      asin: 'b0abcdef12',
      dateRange: { start: '2026-01-01', end: '2026-01-31' },
      keywords: 'a\nb\na',
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.marketplace).toBe('US');
      expect(ok.data.asin).toBe('B0ABCDEF12');
      expect(ok.data.keywords).toEqual(['a', 'b']);
    }

    const bad = mode.inputSchema.safeParse({
      marketplace: 'US',
      asin: 'short',
      dateRange: { start: '2026-02-01', end: '2026-01-01' },
    });
    expect(bad.success).toBe(false);
  });

  it('campaign drilldown requires lingxing capability', () => {
    const mode = getOperationsMode('traffic-campaign-drilldown')!;
    const blocked = evaluateOperationsPreflight(mode, {
      'model.tools': true,
      'company.mcp.lingxing-mcp': false,
    });
    expect(blocked.canRun).toBe(false);
    expect(blocked.missingRequired).toContain('company.mcp.lingxing-mcp');

    const ok = evaluateOperationsPreflight(mode, {
      'model.tools': true,
      'company.mcp.lingxing-mcp': true,
    });
    expect(ok.canRun).toBe(true);
  });

  it('category overview accepts any-of data source group', () => {
    const mode = getOperationsMode('category-market-overview')!;
    const onlySif = evaluateOperationsPreflight(mode, {
      'model.tools': true,
      'company.mcp.sif-mcp': true,
    });
    expect(onlySif.canRun).toBe(true);

    const none = evaluateOperationsPreflight(mode, { 'model.tools': true });
    expect(none.canRun).toBe(false);
  });

  it('optional missing degrades but still runs', () => {
    const mode = getOperationsMode('traffic-single-asin')!;
    const r = evaluateOperationsPreflight(mode, {
      'model.tools': true,
      'company.mcp.sif-mcp': true,
      'company.mcp.lingxing-mcp': false,
    });
    expect(r.canRun).toBe(true);
    expect(r.degraded).toContain('company.mcp.lingxing-mcp');
  });
});

describe('normalize helpers', () => {
  it('dedupes asins and keywords', () => {
    expect(normalizeAsinList('b0aaa11111, B0AAA11111\nb0bbb22222', 10)).toEqual([
      'B0AAA11111',
      'B0BBB22222',
    ]);
    expect(normalizeKeywordList('Foo\nfoo\nBar', 10)).toEqual(['Foo', 'Bar']);
  });

  it('rejects invalid marketplace and bad dates', () => {
    const mode = getOperationsMode('traffic-single-asin')!;
    expect(
      mode.inputSchema.safeParse({
        marketplace: 'XX',
        asin: 'B0ABCDEF12',
        dateRange: { start: '2026-01-01', end: '2026-01-31' },
      }).success,
    ).toBe(false);
    expect(
      mode.inputSchema.safeParse({
        marketplace: 'US',
        asin: 'B0ABCDEF12',
        dateRange: { start: '2026-13-40', end: '2026-01-31' },
      }).success,
    ).toBe(false);
  });

  it('rejects invalid ASINs and overflow instead of silent drop', () => {
    const mode = getOperationsMode('traffic-vs-competitors')!;
    const invalid = mode.inputSchema.safeParse({
      marketplace: 'US',
      asin: 'B0ABCDEF12',
      competitorAsins: 'NOTANASIN, B0ABCDEF12',
      dateRange: { start: '2026-01-01', end: '2026-01-31' },
    });
    expect(invalid.success).toBe(false);

    // hyphenated ASIN must not be silently stripped into a valid one
    const hyphen = mode.inputSchema.safeParse({
      marketplace: 'US',
      asin: 'B0-ABCDEF12',
      competitorAsins: 'B0ABCDEF12',
      dateRange: { start: '2026-01-01', end: '2026-01-31' },
    });
    expect(hyphen.success).toBe(false);

    const overflow = mode.inputSchema.safeParse({
      marketplace: 'US',
      asin: 'B0ABCDEF12',
      competitorAsins: Array.from(
        { length: 11 },
        (_, i) => `B0ABCDEF${String(i).padStart(2, '0')}`,
      ),
      dateRange: { start: '2026-01-01', end: '2026-01-31' },
    });
    expect(overflow.success).toBe(false);
  });
});

describe('extractOpsHtmlArtifact', () => {
  it('extracts closed text/html artifact only', () => {
    expect(extractOpsHtmlArtifact('plain text')).toBeNull();
    expect(
      extractOpsHtmlArtifact(
        'hi\n<lobeArtifact type="text/html" identifier="ops-report"><html><body>ok</body></html></lobeArtifact>',
      ),
    ).toContain('<html>');
    expect(extractOpsHtmlArtifact('<lobeArtifact type="text/html">still open')).toBeNull();
  });
});
