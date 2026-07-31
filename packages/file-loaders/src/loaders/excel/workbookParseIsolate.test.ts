import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as xlsx from 'xlsx';

import { buildWorkbookAssetsIsolated } from './workbookParseIsolate';

const dirs: string[] = [];

beforeAll(() => {
  process.env.WORKBOOK_PARSE_WORKER_PATH = path.resolve(
    process.cwd(),
    'src/loaders/excel/workbookParseWorker.cjs',
  );
});

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  for (const d of dirs) {
    await rm(d, { force: true, recursive: true }).catch(() => undefined);
  }
  dirs.length = 0;
});

describe('buildWorkbookAssetsIsolated', () => {
  it('parses a tiny xlsx in child process (or in-process fallback)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-iso-'));
    dirs.push(dir);
    const filePath = path.join(dir, 't.xlsx');
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet([{ a: 1, b: 'x' }]), 'S1');
    await writeFile(filePath, Buffer.from(xlsx.write(wb, { bookType: 'xlsx', type: 'buffer' })));

    const build = await buildWorkbookAssetsIsolated(filePath, { timeoutMs: 60_000 });
    expect(build.sheetCount).toBe(1);
    expect(build.sheets[0]?.sheetName).toBe('S1');
    expect(build.sheets[0]?.rowCount).toBe(1);
    // Isolated path keeps body on disk — not re-hydrated into jsonl string.
    if (build.sheets[0]?.jsonlPath) {
      const { readFile } = await import('node:fs/promises');
      const body = await readFile(build.sheets[0].jsonlPath, 'utf8');
      expect(body).toContain('"a"');
      await build.dispose?.();
    } else {
      expect(build.sheets[0]?.jsonl).toContain('"a"');
    }
  });

  it('forceInProcess path works', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wb-iso-ip-'));
    dirs.push(dir);
    const filePath = path.join(dir, 't.xlsx');
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet([{ z: 2 }]), 'Z');
    await writeFile(filePath, Buffer.from(xlsx.write(wb, { bookType: 'xlsx', type: 'buffer' })));

    const build = await buildWorkbookAssetsIsolated(filePath, { forceInProcess: true });
    expect(build.sheets[0]?.sheetName).toBe('Z');
  });

  it('does not silently succeed on missing file without forceInProcess', async () => {
    await expect(
      buildWorkbookAssetsIsolated('/tmp/nonexistent-workbook-xyz.xlsx', {
        forceInProcess: false,
        timeoutMs: 30_000,
      }),
    ).rejects.toThrow();
  });
});
