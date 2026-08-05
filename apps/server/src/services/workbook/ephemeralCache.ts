/**
 * In-process ephemeral workbook cache for chat on_demand attachments.
 * Does not write file_workbooks / resource library — TTL-only memory.
 *
 * Key: userId + workspaceId + fileId + fileHash
 * ponytail: process-local Map; multi-instance needs Redis. Ceiling: single-node bot.
 */

import type { WorkbookAssetBuild } from '@lobechat/file-loaders';

export const EPHEMERAL_WORKBOOK_TTL_MS = 6 * 60 * 60 * 1000;
/** Hard cap on cached JSONL bytes across all entries (≈512MB). */
export const EPHEMERAL_WORKBOOK_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
export const EPHEMERAL_WORKBOOK_MAX_ENTRIES = 32;

export type EphemeralWorkbookEntry = {
  build: WorkbookAssetBuild;
  expiresAt: number;
  fileHash: string;
  fileId: string;
  userId: string;
  workspaceId?: string;
};

const cache = new Map<string, EphemeralWorkbookEntry>();

export const ephemeralCacheKey = (params: {
  fileHash: string;
  fileId: string;
  userId: string;
  workspaceId?: string | null;
}): string => `${params.userId}|${params.workspaceId ?? ''}|${params.fileId}|${params.fileHash}`;

const entryBytes = (e: EphemeralWorkbookEntry) =>
  e.build.totalJsonlBytes ||
  e.build.sheets.reduce((s, sh) => s + Buffer.byteLength(sh.jsonl || '', 'utf8'), 0);

const totalBytes = () => {
  let n = 0;
  for (const e of cache.values()) n += entryBytes(e);
  return n;
};

const prune = () => {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
  // Drop oldest (soonest to expire) until under entry + byte caps.
  while (
    cache.size > EPHEMERAL_WORKBOOK_MAX_ENTRIES ||
    totalBytes() > EPHEMERAL_WORKBOOK_MAX_TOTAL_BYTES
  ) {
    if (cache.size === 0) break;
    const ordered = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    cache.delete(ordered[0]![0]);
  }
};

export const getEphemeralWorkbook = (key: string): EphemeralWorkbookEntry | undefined => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry;
};

export const setEphemeralWorkbook = (
  key: string,
  entry: Omit<EphemeralWorkbookEntry, 'expiresAt'> & { ttlMs?: number },
): EphemeralWorkbookEntry => {
  const stored: EphemeralWorkbookEntry = {
    build: entry.build,
    expiresAt: Date.now() + (entry.ttlMs ?? EPHEMERAL_WORKBOOK_TTL_MS),
    fileHash: entry.fileHash,
    fileId: entry.fileId,
    userId: entry.userId,
    workspaceId: entry.workspaceId,
  };
  cache.set(key, stored);
  prune();
  // If single entry still exceeds budget, keep it (must serve current request)
  // but drop everything else.
  if (totalBytes() > EPHEMERAL_WORKBOOK_MAX_TOTAL_BYTES && cache.size > 1) {
    for (const k of cache.keys()) {
      if (k !== key) cache.delete(k);
    }
  }
  return stored;
};

/** Test helper */
export const clearEphemeralWorkbookCache = () => cache.clear();
