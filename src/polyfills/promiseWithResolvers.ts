const promiseWithResolvers = <T>(): PromiseWithResolvers<T> => {
  let resolve!: PromiseWithResolvers<T>['resolve'];
  let reject!: PromiseWithResolvers<T>['reject'];

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
};

export const installPromiseWithResolversPolyfill = () => {
  if (typeof Promise.withResolvers === 'function') return;

  Object.defineProperty(Promise, 'withResolvers', {
    configurable: true,
    value: promiseWithResolvers,
    writable: true,
  });
};
