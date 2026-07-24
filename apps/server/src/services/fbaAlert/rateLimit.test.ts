import { describe, expect, it } from 'vitest';

import { isFbaRateLimitError } from './rateLimit';

describe('isFbaRateLimitError', () => {
  it('detects lingxing 3001008 payload', () => {
    expect(
      isFbaRateLimitError(
        "领星接口返回失败: {'code': '3001008', 'msg': 'new requests too frequently. please request later.', 'data': None}",
      ),
    ).toBe(true);
  });

  it('detects english variants', () => {
    expect(isFbaRateLimitError('too many requests')).toBe(true);
    expect(isFbaRateLimitError('Rate limit exceeded')).toBe(true);
  });

  it('rejects unrelated failures', () => {
    expect(isFbaRateLimitError('Cannot resolve DingTalk notify user id')).toBe(false);
    expect(isFbaRateLimitError(null)).toBe(false);
  });
});
