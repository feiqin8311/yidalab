import { describe, expect, it } from 'vitest';

import { mapPool } from '../resolveAttachments';

describe('mapPool', () => {
  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);

    await mapPool(items, 3, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return item * 2;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('preserves order of results', async () => {
    const result = await mapPool([1, 2, 3, 4], 2, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, (5 - n) * 5));
      return n * 10;
    });
    expect(result).toEqual([10, 20, 30, 40]);
  });
});
