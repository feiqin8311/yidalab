import { afterEach, describe, expect, it } from 'vitest';

import { installUrlParsePolyfill } from './urlParse';

const originalDescriptor = Object.getOwnPropertyDescriptor(URL, 'parse');

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(URL, 'parse', originalDescriptor);
  } else {
    Reflect.deleteProperty(URL, 'parse');
  }
});

describe('installUrlParsePolyfill', () => {
  it('installs URL parsing behavior for older browsers', () => {
    Object.defineProperty(URL, 'parse', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    installUrlParsePolyfill();

    expect(URL.parse('/report.pdf', 'https://example.com/chat')?.href).toBe(
      'https://example.com/report.pdf',
    );
    expect(URL.parse('not a url')).toBeNull();
  });

  it('keeps the browser implementation when it already exists', () => {
    const browserImplementation = () => null;
    Object.defineProperty(URL, 'parse', {
      configurable: true,
      value: browserImplementation,
      writable: true,
    });

    installUrlParsePolyfill();

    expect(URL.parse).toBe(browserImplementation);
  });
});
