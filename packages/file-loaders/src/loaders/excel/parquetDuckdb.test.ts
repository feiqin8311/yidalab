import { describe, expect, it } from 'vitest';

import { isDuckDBAvailable, jsonlToParquetBuffer, queryParquetBuffer } from './parquetDuckdb';
import { SHEET_QUERY_MAX_CHARS } from './querySheet';

describe('parquetDuckdb', () => {
  it('round-trips small jsonl via parquet when duckdb is available', async () => {
    const available = await isDuckDBAvailable();
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const jsonl = [
      JSON.stringify({ brand: 'A', qty: '10' }),
      JSON.stringify({ brand: 'B', qty: '3' }),
      JSON.stringify({ brand: 'A', qty: '7' }),
    ].join('\n');
    const parquet = await jsonlToParquetBuffer(jsonl, ['brand', 'qty']);
    expect(parquet).not.toBeNull();
    expect(parquet!.byteLength).toBeGreaterThan(0);

    const q = await queryParquetBuffer(parquet!, {
      filters: [{ column: 'brand', op: 'eq', value: 'A' }],
      limit: 10,
    });
    expect(q).not.toBeNull();
    expect(q!.returnedRows).toBe(2);
    expect(q!.rows.every((r) => r.brand === 'A')).toBe(true);
  });

  it('applies char budget on parquet query results', async () => {
    const available = await isDuckDBAvailable();
    if (!available) return;
    const huge = 'y'.repeat(SHEET_QUERY_MAX_CHARS + 20_000);
    const jsonl = JSON.stringify({ id: '0', body: huge });
    const parquet = await jsonlToParquetBuffer(jsonl, ['id', 'body']);
    expect(parquet).not.toBeNull();
    const q = await queryParquetBuffer(parquet!, { limit: 1 });
    expect(q).not.toBeNull();
    expect(JSON.stringify(q!.rows).length).toBeLessThanOrEqual(SHEET_QUERY_MAX_CHARS + 64);
    expect(q!.truncated).toBe(true);
  });
});
