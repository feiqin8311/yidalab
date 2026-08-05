import qs from 'query-string';
import urlJoin from 'url-join';

import type { CrawlImpl, CrawlSuccessResult } from '../type';
import { PageNotFoundError, toFetchError } from '../utils/errorType';
import { htmlToMarkdown } from '../utils/htmlToMarkdown';
import { createHTTPStatusError } from '../utils/response';
import { DEFAULT_TIMEOUT, withTimeout } from '../utils/withTimeout';

// Allowed file types: html, css, js, json, xml, webmanifest, txt, md
const REJECT_REQUEST_PATTERN =
  '.*\\.(?!(html|css|js|json|xml|webmanifest|txt|md)(\\?|#|$))[\\w-]+(?:[\\?#].*)?$';

class BrowserlessInitError extends Error {
  constructor() {
    super('`BROWSERLESS_URL` or `BROWSERLESS_TOKEN` are required');
    this.name = 'BrowserlessInitError';
  }
}

export const browserless: CrawlImpl = async (url, { filterOptions }) => {
  // Request-scoped vault (ALS) first; do not cache token at module load.
  const { getVaultEnv } = await import('@lobechat/utils/server/vaultEnv');
  const baseUrl = getVaultEnv('BROWSERLESS_URL') || 'https://chrome.browserless.io';
  const token = getVaultEnv('BROWSERLESS_TOKEN');
  const blockAds = getVaultEnv('BROWSERLESS_BLOCK_ADS') === '1';
  const stealthMode = getVaultEnv('BROWSERLESS_STEALTH_MODE') === '1';

  if (!getVaultEnv('BROWSERLESS_URL') && !token) {
    throw new BrowserlessInitError();
  }

  const input = {
    gotoOptions: { waitUntil: 'networkidle2' },
    rejectRequestPattern: [REJECT_REQUEST_PATTERN],
    url,
  };

  let res: Response;

  try {
    res = await withTimeout(
      (signal) =>
        fetch(
          qs.stringifyUrl({
            query: {
              blockAds,
              launch: JSON.stringify({ stealth: stealthMode }),
              token,
            },
            url: urlJoin(baseUrl, '/content'),
          }),
          {
            body: JSON.stringify(input),
            headers: {
              'Content-Type': 'application/json',
            },
            method: 'POST',
            signal,
          },
        ),
      DEFAULT_TIMEOUT,
    );
  } catch (e) {
    throw toFetchError(e);
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new PageNotFoundError(res.statusText);
    }

    throw await createHTTPStatusError(res, 'Browserless');
  }

  const html = await res.text();
  const result = htmlToMarkdown(html, { filterOptions, url });

  if (
    !!result.content &&
    result.content.length > 100 &&
    result.title &&
    // "Just a moment..." indicates being blocked by CloudFlare
    result.title.trim() !== 'Just a moment...'
  ) {
    return {
      content: result.content,
      contentType: 'text',
      description: result?.description,
      length: result.length,
      siteName: result?.siteName,
      title: result?.title,
      url,
    } satisfies CrawlSuccessResult;
  }

  return;
};
