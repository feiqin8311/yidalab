import { describe, expect, it } from 'vitest';

import { clampHistoryOffset } from './historyOffset';

describe('clampHistoryOffset', () => {
  it('does not reset while not ready (loading)', () => {
    expect(clampHistoryOffset(20, undefined, 20, false)).toBe(20);
    expect(clampHistoryOffset(20, 0, 20, false)).toBe(20);
  });

  it('clamps to last page when total shrinks', () => {
    expect(clampHistoryOffset(20, 20, 20, true)).toBe(0);
    expect(clampHistoryOffset(40, 25, 20, true)).toBe(20);
  });

  it('resets to 0 when empty', () => {
    expect(clampHistoryOffset(20, 0, 20, true)).toBe(0);
  });
});
