import { describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from './context';
import { getOperationCached } from './operationCache';

describe('getOperationCached', () => {
  it('coalesces concurrent loads within an operation', async () => {
    const ctx = {} as RuntimeExecutorContext;
    const loader = vi.fn().mockResolvedValue({ title: 'Topic' });

    const [first, second] = await Promise.all([
      getOperationCached(ctx, 'topic:1', loader),
      getOperationCached(ctx, 'topic:1', loader),
    ]);

    expect(first).toBe(second);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('evicts failed loads so a later turn can retry', async () => {
    const ctx = {} as RuntimeExecutorContext;
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce('ok');

    await expect(getOperationCached(ctx, 'model:1', loader)).rejects.toThrow('temporary');
    await expect(getOperationCached(ctx, 'model:1', loader)).resolves.toBe('ok');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
