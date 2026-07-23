import { describe, expect, it } from 'vitest';

import { buildPlanModeInstruction, isPlanModeEnabled, withPlanModeInstruction } from './planMode';

describe('planMode', () => {
  it('is off by default', () => {
    expect(isPlanModeEnabled(undefined)).toBe(false);
    expect(isPlanModeEnabled(false)).toBe(false);
    expect(isPlanModeEnabled(true)).toBe(true);
  });

  it('builds instruction only when enabled', () => {
    expect(buildPlanModeInstruction(false)).toBe('');
    expect(buildPlanModeInstruction(undefined)).toBe('');
    const on = buildPlanModeInstruction(true);
    expect(on).toContain('Plan Mode');
    expect(on).toContain('任务单');
    expect(on).toContain('askUserQuestion');
  });

  it('appends only when on; leaves role alone when off', () => {
    expect(withPlanModeInstruction('You are helpful.', false)).toBe('You are helpful.');
    const merged = withPlanModeInstruction('You are helpful.', true);
    expect(merged.startsWith('You are helpful.')).toBe(true);
    expect(merged).toContain('Plan Mode');
  });
});
