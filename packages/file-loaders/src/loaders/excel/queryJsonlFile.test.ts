import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { queryJsonlFile } from './parquetDuckdb';

const dirs: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  for (const d of dirs) {
    await rm(d, { force: true, recursive: true }).catch(() => undefined);
  }
  dirs.length = 0;
});

describe('queryJsonlFile', () => {
  it('streams pagination without loading as one giant string path issue', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-qjf-'));
    dirs.push(dir);
    const filePath = path.join(dir, 's.jsonl');
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ brand: i % 2 === 0 ? 'A' : 'B', qty: String(i) }),
    );
    await writeFile(filePath, lines.join('\n'));

    const page1 = await queryJsonlFile(filePath, { limit: 2 });
    expect(page1.returnedRows).toBe(2);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await queryJsonlFile(filePath, { cursor: page1.nextCursor, limit: 2 });
    expect(page2.returnedRows).toBe(2);

    const filtered = await queryJsonlFile(filePath, {
      filters: [{ column: 'brand', op: 'eq', value: 'A' }],
      limit: 10,
    });
    expect(filtered.rows.every((r) => r.brand === 'A')).toBe(true);
  });

  it('clamps single oversized row under SHEET_QUERY_MAX_CHARS', async () => {
    const { SHEET_QUERY_MAX_CHARS } = await import('./querySheet');
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-qjf-big-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'big.jsonl');
    const huge = 'y'.repeat(SHEET_QUERY_MAX_CHARS + 50_000);
    await writeFile(filePath, JSON.stringify({ id: '0', body: huge }));

    const r = await queryJsonlFile(filePath, { limit: 1 });
    expect(r.returnedRows).toBe(1);
    expect(JSON.stringify(r.rows).length).toBeLessThanOrEqual(SHEET_QUERY_MAX_CHARS + 64);
    expect(r.truncated).toBe(true);
  });
});
