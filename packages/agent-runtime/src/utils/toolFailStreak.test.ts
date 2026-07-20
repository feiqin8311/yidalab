import { describe, expect, it } from 'vitest';

import {
  normalizeToolErrorSignature,
  recordToolFailOutcome,
  toolFailStreakKey,
} from './toolFailStreak';

describe('recordToolFailOutcome', () => {
  it('increments and force-finishes at limit', () => {
    let streaks: Record<string, number> = {};
    for (let i = 1; i <= 2; i++) {
      const r = recordToolFailOutcome({
        errorMessage: 'MARKET_AUTH_REQUIRED',
        isSuccess: false,
        limit: 3,
        streaks,
        toolName: 'lobe-cloud-sandbox.writeFile',
      });
      expect(r.forceFinish).toBe(false);
      streaks = r.streaks;
    }
    const third = recordToolFailOutcome({
      errorMessage: 'MARKET_AUTH_REQUIRED',
      isSuccess: false,
      limit: 3,
      streaks,
      toolName: 'lobe-cloud-sandbox.writeFile',
    });
    expect(third.forceFinish).toBe(true);
    expect(third.reason).toContain('3 times');
  });

  it('clears tool keys on success', () => {
    const afterFail = recordToolFailOutcome({
      errorMessage: 'boom',
      isSuccess: false,
      limit: 3,
      toolName: 'foo',
    });
    const afterOk = recordToolFailOutcome({
      isSuccess: true,
      limit: 3,
      streaks: afterFail.streaks,
      toolName: 'foo',
    });
    expect(Object.keys(afterOk.streaks)).toHaveLength(0);
  });
});

describe('normalizeToolErrorSignature', () => {
  it('strips uuids', () => {
    expect(normalizeToolErrorSignature('fail a1b2c3d4-e5f6-7890-abcd-ef1234567890 end')).toContain(
      '<id>',
    );
  });
});

describe('toolFailStreakKey', () => {
  it('joins', () => {
    expect(toolFailStreakKey('a', 'b')).toBe('a::b');
  });
});
