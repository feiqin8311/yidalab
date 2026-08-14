import type { RuntimeExecutorContext } from './context';

export const getOperationCached = <T>(
  ctx: RuntimeExecutorContext,
  key: string,
  loader: () => Promise<T>,
): Promise<T> => {
  const cache = (ctx.operationCache ??= new Map());
  const existing = cache.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = loader().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, promise);
  return promise;
};
