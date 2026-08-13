import { describe, expect, it } from 'vitest';

import { parseQuotaResetAt } from './parseQuotaResetAt';

describe('parseQuotaResetAt', () => {
  it('reads the rolling-window reset time', () => {
    expect(
      parseQuotaResetAt(
        '429 You have exceeded the 5-hour usage quota. It will reset at 2026-08-13 13:41:39 +0800 CST.',
      ),
    ).toBe('2026-08-13 13:41');
  });

  it('returns undefined when the message has no reset time', () => {
    expect(parseQuotaResetAt('quota exhausted')).toBeUndefined();
  });
});
