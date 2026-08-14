const urlParse = (url: string | URL, base?: string | URL): URL | null => {
  try {
    return new URL(url, base);
  } catch {
    return null;
  }
};

export const installUrlParsePolyfill = () => {
  if (typeof URL.parse === 'function') return;

  Object.defineProperty(URL, 'parse', {
    configurable: true,
    value: urlParse,
    writable: true,
  });
};
