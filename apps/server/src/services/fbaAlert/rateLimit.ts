/**
 * Lingxing / fba-bot rate-limit signals we should wait-and-retry instead of
 * failing the agent tool immediately (e.g. code 3001008).
 */
export const isFbaRateLimitError = (message?: string | null): boolean => {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('3001008') ||
    lower.includes('too frequently') ||
    lower.includes('request later') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    message.includes('过于频繁') ||
    message.includes('请求过于频繁')
  );
};

/** Backoff waits between retries (not including the first attempt). */
export const DEFAULT_FBA_RATE_LIMIT_WAITS_MS = [30_000, 60_000, 90_000] as const;

export const sleepMs = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
