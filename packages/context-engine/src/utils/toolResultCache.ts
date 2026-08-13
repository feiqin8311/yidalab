/**
 * Operation-level read-only tool result cache.
 * Key: identifier + apiName + canonical args hash.
 * Only successful, explicitly cacheable / read-only tools.
 */

export interface ToolResultCacheEntry {
  /** Already model-shaped content (post 8k/archive). Never store raw MCP state. */
  content: string;
  originalCallId: string;
  success: boolean;
  timestamp: number;
}

/** Soft cap: drop oldest entries when over this many keys (Redis state size). */
export const MAX_TOOL_RESULT_CACHE_ENTRIES = 32;
/** Soft cap: skip writing entries larger than this (chars). */
export const MAX_TOOL_RESULT_CACHE_ENTRY_CHARS = 48_000;

/**
 * Serializable cache index (JSON-safe for operation metadata).
 * Never use Map — AgentStateManager JSON.stringify drops Map entries to {}.
 */
export type ToolResultCacheIndex = Record<string, ToolResultCacheEntry>;

export const createToolResultCache = (): ToolResultCacheIndex => ({});

/** Monotonic clock so same-ms batch write/hit/evict still ranks correctly. */
let lastCacheClock = 0;

export const nextCacheTimestamp = (floor?: number): number => {
  const base = Math.max(Date.now(), floor ?? 0, lastCacheClock + 1);
  lastCacheClock = base;
  return base;
};

const maxTimestampIn = (index: ToolResultCacheIndex): number => {
  let max = 0;
  for (const k of Object.keys(index)) {
    const t = index[k]?.timestamp ?? 0;
    if (t > max) max = t;
  }
  return max;
};

export const ensureToolResultCache = (value: unknown): ToolResultCacheIndex => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    // Hydrate plain object; ignore residual Map instances from older runs
    if (value instanceof Map) {
      const out: ToolResultCacheIndex = {};
      for (const [k, v] of value.entries()) {
        if (typeof k === 'string' && v && typeof v === 'object') out[k] = v as ToolResultCacheEntry;
      }
      return out;
    }
    return value as ToolResultCacheIndex;
  }
  return createToolResultCache();
};

/** Recursively sort object keys for stable JSON hashing. */
export const canonicalJson = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
};

/** FNV-1a 32-bit — small, dependency-free. */
export const hashString = (input: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

export const buildToolCacheKey = (identifier: string, apiName: string, args: unknown): string => {
  let parsed: unknown = args;
  if (typeof args === 'string') {
    try {
      parsed = JSON.parse(args);
    } catch {
      parsed = args;
    }
  }
  return `${identifier}::${apiName}::${hashString(canonicalJson(parsed))}`;
};

export interface CacheableToolHint {
  /** Manifest-level policy */
  cachePolicy?: 'operation' | 'none' | string;
  /** MCP annotation style */
  readOnlyHint?: boolean;
}

export interface ToolCacheManifestLike {
  api?: Array<{
    annotations?: { readOnlyHint?: boolean };
    cachePolicy?: string;
    name?: string;
    readOnlyHint?: boolean;
  }>;
  cachePolicy?: string;
}

/** Query-shaped SIF APIs. Never treat write/update/upload as cacheable. */
const SIF_QUERY_API = /^(?:ads_get_|ops_get_|market_get_|get_|query_|search_|list_|lookup_)/i;

export const isSifQueryTool = (identifier: string, apiName: string): boolean => {
  const id = identifier.toLowerCase();
  if (!id.includes('sif-mcp') && id !== 'sif' && !id.endsWith('.sif')) return false;
  return SIF_QUERY_API.test(apiName);
};

/**
 * Only cache when explicitly marked read-only / operation-cacheable.
 * Side-effect tools never cache.
 */
export const isToolCacheable = (hint?: CacheableToolHint | null): boolean => {
  if (!hint) return false;
  if (hint.cachePolicy === 'none') return false;
  if (hint.cachePolicy === 'operation') return true;
  if (hint.readOnlyHint === true) return true;
  return false;
};

/**
 * Resolve cache policy from the tool manifest, then fall back to known
 * read-only SIF query APIs so already-installed manifests still dedup.
 */
export const resolveToolCacheHint = (params: {
  apiName: string;
  identifier: string;
  manifest?: ToolCacheManifestLike | null;
}): CacheableToolHint => {
  const api = params.manifest?.api?.find((item) => item.name === params.apiName);
  const explicitReadOnly = api?.readOnlyHint ?? api?.annotations?.readOnlyHint;
  const hint: CacheableToolHint = {
    cachePolicy: api?.cachePolicy ?? params.manifest?.cachePolicy,
    readOnlyHint: explicitReadOnly,
  };
  if (hint.cachePolicy === 'none') return hint;
  // Explicit false must beat the SIF name heuristic (side-effect tools).
  if (explicitReadOnly === false) return hint;
  if (isToolCacheable(hint)) return hint;
  if (isSifQueryTool(params.identifier, params.apiName)) {
    return { cachePolicy: 'operation', readOnlyHint: true };
  }
  return hint;
};

/** Fields to persist on a converted MCP → LobeChat API entry. */
export const mcpToolCacheFields = (
  identifier: string,
  tool: {
    annotations?: { readOnlyHint?: boolean };
    cachePolicy?: string;
    name: string;
    readOnlyHint?: boolean;
  },
): {
  annotations?: { readOnlyHint: true };
  cachePolicy?: string;
  readOnlyHint?: true;
} => {
  const hint = resolveToolCacheHint({
    apiName: tool.name,
    identifier,
    manifest: {
      api: [
        {
          annotations: tool.annotations,
          cachePolicy: tool.cachePolicy,
          name: tool.name,
          readOnlyHint: tool.readOnlyHint,
        },
      ],
    },
  });
  if (!isToolCacheable(hint)) return {};
  return {
    annotations: { readOnlyHint: true },
    cachePolicy: hint.cachePolicy ?? 'operation',
    readOnlyHint: true,
  };
};

/** Shallow-clone index + entries so Immer-frozen metadata can be updated. */
export const cloneToolResultCache = (index: ToolResultCacheIndex): ToolResultCacheIndex => {
  const out: ToolResultCacheIndex = {};
  for (const key of Object.keys(index)) {
    const entry = index[key];
    if (entry) out[key] = { ...entry };
  }
  return out;
};

export const lookupToolCache = (
  index: ToolResultCacheIndex | undefined,
  key: string,
): ToolResultCacheEntry | undefined => {
  const entry = index?.[key];
  if (!entry || !index) return entry;
  // Touch for true LRU: monotonic so same-ms batch cannot re-evict a hot key.
  // Never mutate a frozen Immer draft leftover — replace the slot instead.
  const touched: ToolResultCacheEntry = {
    ...entry,
    timestamp: nextCacheTimestamp(maxTimestampIn(index)),
  };
  if (Object.isExtensible(index) && Object.isExtensible(entry)) {
    entry.timestamp = touched.timestamp;
    return entry;
  }
  if (Object.isExtensible(index)) {
    index[key] = touched;
  }
  return touched;
};

export const writeToolCache = (
  index: ToolResultCacheIndex,
  key: string,
  entry: ToolResultCacheEntry,
): void => {
  if (!Object.isExtensible(index)) return;

  // Skip oversized model views — better re-execute than bloat Redis state.
  if (entry.content.length > MAX_TOOL_RESULT_CACHE_ENTRY_CHARS) return;

  // Stamp with monotonic time when caller left timestamp unset/stale
  const stamped: ToolResultCacheEntry = {
    ...entry,
    timestamp: nextCacheTimestamp(Math.max(entry.timestamp ?? 0, maxTimestampIn(index))),
  };
  index[key] = stamped;

  const keys = Object.keys(index);
  if (keys.length <= MAX_TOOL_RESULT_CACHE_ENTRIES) return;

  // Evict oldest by timestamp (LRU via write + lookup touch)
  keys
    .map((k) => ({ k, t: index[k]?.timestamp ?? 0 }))
    .sort((a, b) => a.t - b.t)
    .slice(0, keys.length - MAX_TOOL_RESULT_CACHE_ENTRIES)
    .forEach(({ k }) => {
      delete index[k];
    });
};

/**
 * Rebuild cache index from operation messages (role=tool with plugin metadata).
 * Enables resume / cross-process continuity without a DB migration.
 */
export const rebuildToolCacheFromMessages = (
  messages: Array<{
    content?: string;
    plugin?: { apiName?: string; arguments?: string; id?: string; identifier?: string };
    role?: string;
    tool_call_id?: string;
  }>,
  isCacheable: (identifier: string, apiName: string) => boolean,
): ToolResultCacheIndex => {
  const index: ToolResultCacheIndex = createToolResultCache();
  for (const msg of messages) {
    if (msg.role !== 'tool' || !msg.plugin?.identifier || !msg.plugin?.apiName) continue;
    if (!isCacheable(msg.plugin.identifier, msg.plugin.apiName)) continue;
    // Skip failures / empty
    if (!msg.content) continue;
    try {
      const parsed = JSON.parse(msg.content);
      if (parsed && typeof parsed === 'object' && parsed.success === false) continue;
    } catch {
      // plain text success path
    }
    const key = buildToolCacheKey(
      msg.plugin.identifier,
      msg.plugin.apiName,
      msg.plugin.arguments ?? {},
    );
    // Keep latest (monotonic so rebuild order is stable for eviction)
    index[key] = {
      content: msg.content,
      originalCallId: msg.tool_call_id || msg.plugin.id || '',
      success: true,
      timestamp: nextCacheTimestamp(maxTimestampIn(index)),
    };
  }
  return index;
};

/**
 * Model-facing dedup hit: return the cached modelView in full.
 * Content was already 8k-shaped / archived on first write, so re-injecting
 * it is safe and avoids the "pruned original + 800-char stub" trap.
 */
export const buildDedupHitContent = (entry: ToolResultCacheEntry): string =>
  `[tool_dedup_hit] original_call=${entry.originalCallId} success=${entry.success}\n` +
  `Reusing prior read-only result (not re-executed).\n\n` +
  entry.content;
