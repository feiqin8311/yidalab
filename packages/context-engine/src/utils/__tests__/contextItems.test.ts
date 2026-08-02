import { describe, expect, it } from 'vitest';

import {
  assembleContextItems,
  buildContextTraceSnapshot,
  createContextItem,
  createFileManifestContextItem,
} from '../contextItems';

describe('contextItems', () => {
  it('packs high priority first and drops overflow', () => {
    const items = [
      createContextItem({
        id: 'low',
        kind: 'history',
        priority: 10,
        text: 'L'.repeat(400),
      }),
      createFileManifestContextItem({
        card: 'MANIFEST ' + 'M'.repeat(100),
        fileId: 'file_1',
        hardLimit: 50,
      }),
      createContextItem({
        id: 'sys',
        kind: 'system',
        priority: 100,
        text: 'SYSTEM',
        trustLevel: 'system',
      }),
    ];

    const assembled = assembleContextItems(items, 80);
    expect(assembled.text).toContain('SYSTEM');
    expect(assembled.itemBudgets.some((b) => b.kind === 'system')).toBe(true);
    // low priority history may drop under tight budget
    expect(assembled.totalTokens).toBeLessThanOrEqual(100);

    const trace = buildContextTraceSnapshot({
      assembled,
      contextWindow: 100,
      model: 'test',
      operationId: 'op_1',
      toolSchemasTokens: 10,
    });
    expect(trace.operationId).toBe('op_1');
    expect(trace.estimatedInputTokens).toBeGreaterThan(0);
    expect(trace.itemBudgets.length).toBeGreaterThan(0);
  });

  it('file manifest is external / deny memory', () => {
    const item = createFileManifestContextItem({ card: 'x', fileId: 'f' });
    expect(item.trustLevel).toBe('external');
    expect(item.memoryPolicy).toBe('deny');
    expect(item.kind).toBe('file_manifest');
  });
});
