import { type ChildProcess, fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { WorkbookAssetBuild, WorkbookSheetAssetBuild } from './workbookAsset';

/** Default hard kill budget for one child parse (matches async task ~5m). */
export const WORKBOOK_PARSE_CHILD_TIMEOUT_MS = (60 * 5 - 5) * 1000;
/** Child V8 heap hard ceiling (MB). */
export const WORKBOOK_PARSE_CHILD_MAX_OLD_SPACE_MB = 512;

/**
 * Worker script path comes ONLY from WORKBOOK_PARSE_WORKER_PATH.
 * Turbopack treats path.join(cwd, …) / fork(staticPath) as module resolution and
 * fails the Next docker build — do not construct filesystem paths here.
 *
 * Production: Dockerfile sets WORKBOOK_PARSE_WORKER_PATH=/app/workbookParseWorker.cjs
 * Local tests: set the env to the absolute path of workbookParseWorker.cjs
 * Debug: WORKBOOK_PARSE_IN_PROCESS=1 skips the child entirely
 */
const resolveWorkerPath = (): string => {
  const fromEnv = process.env.WORKBOOK_PARSE_WORKER_PATH;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  throw new Error(
    'WORKBOOK_PARSE_WORKER_PATH is not set. Point it at workbookParseWorker.cjs, or set WORKBOOK_PARSE_IN_PROCESS=1 for local debug.',
  );
};

export interface IsolatedParseOptions {
  /**
   * Allow in-process parse. Production workers must leave this false unless
   * WORKBOOK_PARSE_IN_PROCESS=1 is set for local debugging.
   */
  forceInProcess?: boolean;
  /** Child --max-old-space-size (MB). */
  maxOldSpaceMb?: number;
  /** Kill child after this many ms. */
  timeoutMs?: number;
}

type WorkerSheetMeta = {
  columnCount: number;
  columns: string[];
  jsonlBytes: number;
  jsonlPath: string;
  rowCount: number;
  sampleRows: Record<string, string>[];
  sheetIndex: number;
  sheetName: string;
};

type WorkerResult = {
  coverage: WorkbookAssetBuild['coverage'];
  outDir: string;
  parserVersion: string;
  sheetCount: number;
  sheets: WorkerSheetMeta[];
  totalJsonlBytes: number;
  totalRows: number;
  unrestrictedTokenEstimate: number;
};

/**
 * Map worker meta to asset build WITHOUT reading full JSONL into memory.
 * Caller must upload from jsonlPath then await dispose().
 */
const mapWorkerResult = (raw: WorkerResult, dispose: () => Promise<void>): WorkbookAssetBuild => {
  const sheets: WorkbookSheetAssetBuild[] = raw.sheets.map((s) => ({
    columnCount: s.columnCount,
    columns: s.columns,
    jsonl: '',
    jsonlPath: s.jsonlPath,
    rowCount: s.rowCount,
    sampleRows: s.sampleRows,
    sheetIndex: s.sheetIndex,
    sheetName: s.sheetName,
  }));
  return {
    coverage: raw.coverage,
    dispose,
    parserVersion: raw.parserVersion,
    sheetCount: raw.sheetCount,
    sheets,
    totalJsonlBytes: raw.totalJsonlBytes,
    totalRows: raw.totalRows,
    unrestrictedTokenEstimate: raw.unrestrictedTokenEstimate,
  };
};

/**
 * Parse XLSX in a forked Node process so timeout can SIGKILL and free memory.
 * Production is fail-closed: missing worker / fork failure throws unless
 * WORKBOOK_PARSE_IN_PROCESS=1 or forceInProcess.
 */
export async function buildWorkbookAssetsIsolated(
  filePath: string,
  options: IsolatedParseOptions = {},
): Promise<WorkbookAssetBuild> {
  const allowInProcess =
    options.forceInProcess === true || process.env.WORKBOOK_PARSE_IN_PROCESS === '1';

  if (allowInProcess) {
    const { buildWorkbookAssetsFromPathUnlocked } = await import('./workbookAsset');
    return buildWorkbookAssetsFromPathUnlocked(filePath);
  }

  const timeoutMs = options.timeoutMs ?? WORKBOOK_PARSE_CHILD_TIMEOUT_MS;
  const heapMb = options.maxOldSpaceMb ?? WORKBOOK_PARSE_CHILD_MAX_OLD_SPACE_MB;
  const workerPath = resolveWorkerPath();

  if (!existsSync(/* turbopackIgnore: true */ workerPath)) {
    throw new Error(
      `Workbook parse worker missing at ${workerPath}. Set WORKBOOK_PARSE_IN_PROCESS=1 only for local debug.`,
    );
  }

  const outDir = await mkdtemp(path.join(tmpdir(), 'wb-parse-'));
  const dispose = async () => {
    await rm(outDir, { force: true, recursive: true }).catch(() => undefined);
  };

  try {
    const raw = await new Promise<WorkerResult>((resolve, reject) => {
      let child: ChildProcess;
      try {
        // Turbopack treats a direct `fork(workerPath)` call as a module import
        // during production tracing. The path is intentionally runtime-only.
        child = Reflect.apply(fork, undefined, [
          workerPath,
          [filePath, outDir],
          {
            execArgv: [`--max-old-space-size=${heapMb}`],
            serialization: 'json',
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          },
        ]) as ChildProcess;
      } catch (err) {
        reject(
          new Error(
            `Failed to fork workbook parse worker: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        return;
      }

      let settled = false;
      let stderr = '';
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        settle(() =>
          reject(
            new Error(
              `Workbook parse child timed out after ${timeoutMs}ms and was killed (file=${filePath})`,
            ),
          ),
        );
      }, timeoutMs);

      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk);
        if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
      });

      child.on('message', (msg: { ok?: boolean; result?: WorkerResult; error?: string }) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.ok && msg.result) {
          settle(() => resolve(msg.result!));
          return;
        }
        settle(() => reject(new Error(msg.error || 'Workbook parse worker failed')));
      });

      child.on('error', (err) => {
        settle(() => reject(err));
      });

      child.on('exit', (code, signal) => {
        if (settled) return;
        if (signal === 'SIGKILL') {
          settle(() =>
            reject(new Error(`Workbook parse child killed (${signal}); possible timeout or OOM`)),
          );
          return;
        }
        settle(() =>
          reject(
            new Error(
              `Workbook parse child exited code=${code} signal=${signal}${stderr ? `: ${stderr.trim()}` : ''}`,
            ),
          ),
        );
      });
    });

    return mapWorkerResult(raw, dispose);
  } catch (e) {
    await dispose();
    throw e;
  }
}
