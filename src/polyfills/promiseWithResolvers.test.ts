import { afterEach, describe, expect, it } from 'vitest';

import { installPromiseWithResolversPolyfill } from './promiseWithResolvers';

const originalDescriptor = Object.getOwnPropertyDescriptor(Promise, 'withResolvers');

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(Promise, 'withResolvers', originalDescriptor);
  } else {
    Reflect.deleteProperty(Promise, 'withResolvers');
  }
});

describe('installPromiseWithResolversPolyfill', () => {
  it('installs a working fallback when the browser does not provide the API', async () => {
    Object.defineProperty(Promise, 'withResolvers', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    installPromiseWithResolversPolyfill();

    const resolved = Promise.withResolvers<number>();
    resolved.resolve(42);
    await expect(resolved.promise).resolves.toBe(42);

    const rejected = Promise.withResolvers<void>();
    rejected.reject(new Error('failed'));
    await expect(rejected.promise).rejects.toThrow('failed');
  });

  it('keeps the browser implementation when it already exists', () => {
    const browserImplementation = () => {
      throw new Error('should not be called');
    };
    Object.defineProperty(Promise, 'withResolvers', {
      configurable: true,
      value: browserImplementation,
      writable: true,
    });

    installPromiseWithResolversPolyfill();

    expect(Promise.withResolvers).toBe(browserImplementation);
  });
});
