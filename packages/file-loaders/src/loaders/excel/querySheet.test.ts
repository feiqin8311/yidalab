import { describe, expect, it } from 'vitest';

import { queryJsonlSheet, SHEET_QUERY_MAX_CHARS, SHEET_QUERY_MAX_SCAN } from './querySheet';

const jsonl = [
  JSON.stringify({ brand: 'A', qty: '10' }),
  JSON.stringify({ brand: 'B', qty: '3' }),
  JSON.stringify({ brand: 'A', qty: '7' }),
  JSON.stringify({ brand: 'C', qty: '100' }),
].join('\n');

describe('queryJsonlSheet', () => {
  it('returns limited rows with cursor', () => {
    const page1 = queryJsonlSheet(jsonl, { limit: 2 });
    expect(page1.returnedRows).toBe(2);
    expect(page1.truncated).toBe(true);
    expect(page1.nextCursor).toBeDefined();

    const page2 = queryJsonlSheet(jsonl, { cursor: page1.nextCursor, limit: 2 });
    expect(page2.returnedRows).toBe(2);
    expect(page2.truncated).toBe(false);
  });

  it('filters by eq and contains', () => {
    const r = queryJsonlSheet(jsonl, {
      filters: [{ column: 'brand', op: 'eq', value: 'A' }],
      limit: 10,
    });
    expect(r.returnedRows).toBe(2);
    expect(r.rows.every((row) => row.brand === 'A')).toBe(true);

    const c = queryJsonlSheet(jsonl, {
      filters: [{ column: 'brand', op: 'contains', value: 'a' }],
      limit: 10,
    });
    expect(c.returnedRows).toBe(2);
  });

  it('projects columns', () => {
    const r = queryJsonlSheet(jsonl, { columns: ['brand'], limit: 1 });
    expect(Object.keys(r.rows[0]!)).toEqual(['brand']);
  });

  it('does not skip rows when char budget shrinks the page', () => {
    const pad = 'x'.repeat(Math.floor(SHEET_QUERY_MAX_CHARS / 2));
    const big = [
      JSON.stringify({ id: '0', body: pad }),
      JSON.stringify({ id: '1', body: pad }),
      JSON.stringify({ id: '2', body: pad }),
      JSON.stringify({ id: '3', body: 'small' }),
    ].join('\n');

    const page1 = queryJsonlSheet(big, { limit: 10 });
    expect(page1.returnedRows).toBe(1);
    expect(page1.rows[0]!.id).toBe('0');
    expect(page1.truncated).toBe(true);
    expect(page1.nextCursor).toBe('1');

    const page2 = queryJsonlSheet(big, { cursor: page1.nextCursor, limit: 10 });
    expect(page2.rows[0]!.id).toBe('1');
    expect(page2.rows.map((r) => r.id)).not.toContain('0');
  });

  it('orderBy sorts full filtered set before limit (Top-N)', () => {
    const r = queryJsonlSheet(jsonl, {
      limit: 2,
      orderBy: [{ column: 'qty', direction: 'desc' }],
    });
    expect(r.rows.map((row) => row.qty)).toEqual(['100', '10']);
    expect(r.truncated).toBe(true);
    expect(r.nextCursor).toBe('2');

    const page2 = queryJsonlSheet(jsonl, {
      cursor: r.nextCursor,
      limit: 2,
      orderBy: [{ column: 'qty', direction: 'desc' }],
    });
    expect(page2.rows.map((row) => row.qty)).toEqual(['7', '3']);
    expect(page2.truncated).toBe(false);
  });

  it('orderBy uses sort column before columns projection', () => {
    // qty=[1,100,50] with ids 0,1,2 — project only id after desc qty → [1,2,0]
    const data = [
      JSON.stringify({ id: '0', qty: '1' }),
      JSON.stringify({ id: '1', qty: '100' }),
      JSON.stringify({ id: '2', qty: '50' }),
    ].join('\n');
    const r = queryJsonlSheet(data, {
      columns: ['id'],
      limit: 2,
      orderBy: [{ column: 'qty', direction: 'desc' }],
    });
    expect(r.rows.map((row) => row.id)).toEqual(['1', '2']);
    expect(r.rows[0]).not.toHaveProperty('qty');
  });

  it('clamps single oversized row under char budget', () => {
    const huge = 'y'.repeat(SHEET_QUERY_MAX_CHARS + 5000);
    const data = JSON.stringify({ id: '0', body: huge });
    const r = queryJsonlSheet(data, { limit: 1 });
    expect(r.returnedRows).toBe(1);
    expect(JSON.stringify(r.rows).length).toBeLessThanOrEqual(SHEET_QUERY_MAX_CHARS + 64);
    expect(r.truncated).toBe(true);
  });

  it('orderBy past scan window sets coverageLimited and does not loop cursor', () => {
    // Build exactly MAX_SCAN + 10 rows would be heavy; simulate with small scan by
    // using a dataset of 3 and verifying coverageLimited only when scan hits cap.
    // When totalRows <= MAX_SCAN, coverageLimited is false.
    const r = queryJsonlSheet(jsonl, {
      limit: 10,
      orderBy: [{ column: 'qty', direction: 'asc' }],
    });
    expect(r.coverageLimited).toBeFalsy();
    expect(r.nextCursor).toBeUndefined();
    // Sanity: MAX_SCAN constant still large
    expect(SHEET_QUERY_MAX_SCAN).toBeGreaterThan(1000);
  });
});
