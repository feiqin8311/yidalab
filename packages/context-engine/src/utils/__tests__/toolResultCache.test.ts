import { describe, expect, it } from 'vitest';

import {
  buildDedupHitContent,
  buildToolCacheKey,
  canonicalJson,
  createToolResultCache,
  isToolCacheable,
  lookupToolCache,
  MAX_TOOL_RESULT_CACHE_ENTRIES,
  rebuildToolCacheFromMessages,
  writeToolCache,
} from '../toolResultCache';

describe('canonicalJson', () => {
  it('is order-insensitive for object keys', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
});

describe('buildToolCacheKey', () => {
  it('same args different key order → same key', () => {
    const a = buildToolCacheKey('sif', 'query', { asin: 'B01', marketplace: 'US' });
    const b = buildToolCacheKey('sif', 'query', '{"marketplace":"US","asin":"B01"}');
    expect(a).toBe(b);
  });
});

describe('isToolCacheable', () => {
  it('requires explicit hint', () => {
    expect(isToolCacheable(undefined)).toBe(false);
    expect(isToolCacheable({})).toBe(false);
    expect(isToolCacheable({ readOnlyHint: true })).toBe(true);
    expect(isToolCacheable({ cachePolicy: 'operation' })).toBe(true);
    expect(isToolCacheable({ cachePolicy: 'none', readOnlyHint: true })).toBe(false);
  });
});

describe('rebuildToolCacheFromMessages', () => {
  it('rebuilds from successful tool messages', () => {
    const index = rebuildToolCacheFromMessages(
      [
        {
          content: '{"ok":true}',
          plugin: {
            apiName: 'query',
            arguments: '{"asin":"B01"}',
            identifier: 'sif',
          },
          role: 'tool',
          tool_call_id: 'c1',
        },
      ],
      () => true,
    );
    const key = buildToolCacheKey('sif', 'query', { asin: 'B01' });
    expect(index[key]?.originalCallId).toBe('c1');
  });
});

describe('buildDedupHitContent', () => {
  it('returns full cached modelView, not an 800-char stub', () => {
    const body = 'x'.repeat(2000);
    const s = buildDedupHitContent({
      content: body,
      originalCallId: 'c9',
      success: true,
      timestamp: 1,
    });
    expect(s).toContain('c9');
    expect(s).toContain('tool_dedup_hit');
    expect(s).toContain(body);
  });
});

describe('lookupToolCache LRU touch', () => {
  it('refreshes timestamp on hit with strict increase', () => {
    const index = createToolResultCache();
    writeToolCache(index, 'k', {
      content: 'v',
      originalCallId: 'c1',
      success: true,
      timestamp: 1,
    });
    const before = index.k!.timestamp;
    const hit = lookupToolCache(index, 'k');
    expect(hit?.content).toBe('v');
    expect(hit!.timestamp).toBeGreaterThan(before);
    expect(index.k!.timestamp).toBe(hit!.timestamp);
  });

  it('keeps recently hit entry when overflowing capacity', () => {
    const index = createToolResultCache();
    // Fill to capacity with distinct keys
    for (let i = 0; i < MAX_TOOL_RESULT_CACHE_ENTRIES; i++) {
      writeToolCache(index, `k${i}`, {
        content: `v${i}`,
        originalCallId: `c${i}`,
        success: true,
        timestamp: i + 1,
      });
    }
    expect(Object.keys(index)).toHaveLength(MAX_TOOL_RESULT_CACHE_ENTRIES);

    // Touch the oldest write — must survive the next overflow write
    const hit = lookupToolCache(index, 'k0');
    expect(hit?.content).toBe('v0');

    writeToolCache(index, 'k-new', {
      content: 'fresh',
      originalCallId: 'c-new',
      success: true,
      timestamp: 0,
    });

    expect(Object.keys(index)).toHaveLength(MAX_TOOL_RESULT_CACHE_ENTRIES);
    expect(index['k0']?.content).toBe('v0');
    expect(index['k-new']?.content).toBe('fresh');
    // Some other non-touched key was evicted
    expect(Object.keys(index).some((k) => k.startsWith('k') && k !== 'k0' && k !== 'k-new')).toBe(
      true,
    );
  });
});
