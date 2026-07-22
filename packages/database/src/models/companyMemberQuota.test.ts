import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MEMBER_MONTHLY_CREDITS,
  DEFAULT_MEMBER_MONTHLY_LIMIT_COST,
  getQuotaCycleBounds,
  isModelAllowed,
  modelKey,
  QUOTA_CYCLE_DAYS,
  QUOTA_CYCLE_MS,
  resolveEffectiveMonthlyLimit,
} from './companyMemberQuota';

describe('getQuotaCycleBounds', () => {
  it('uses fixed 30-day windows', () => {
    expect(QUOTA_CYCLE_DAYS).toBe(30);
    const now = new Date('2026-07-22T12:00:00.000Z');
    const { start, end } = getQuotaCycleBounds(now);
    expect(end.getTime() - start.getTime()).toBe(QUOTA_CYCLE_MS);
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(end.getTime()).toBeGreaterThan(now.getTime());
    // start aligned to cycle grid
    expect(start.getTime() % QUOTA_CYCLE_MS).toBe(0);
  });

  it('stays in the same cycle within 30 days', () => {
    const a = getQuotaCycleBounds(new Date('2026-07-01T00:00:00.000Z'));
    const b = getQuotaCycleBounds(new Date(a.start.getTime() + QUOTA_CYCLE_MS - 1));
    expect(a.start.getTime()).toBe(b.start.getTime());
    expect(a.end.getTime()).toBe(b.end.getTime());
  });
});

describe('resolveEffectiveMonthlyLimit', () => {
  it('uses 500k credits default when no policy row', () => {
    const result = resolveEffectiveMonthlyLimit(null);
    expect(result).toEqual({
      isDefault: true,
      monthlyLimitCost: DEFAULT_MEMBER_MONTHLY_LIMIT_COST,
      unlimited: false,
    });
    expect(DEFAULT_MEMBER_MONTHLY_CREDITS).toBe(500_000);
    expect(DEFAULT_MEMBER_MONTHLY_LIMIT_COST).toBe(0.5);
  });

  it('treats explicit null limit as unlimited', () => {
    expect(resolveEffectiveMonthlyLimit({ monthlyLimitCost: null })).toEqual({
      isDefault: false,
      monthlyLimitCost: null,
      unlimited: true,
    });
  });

  it('keeps a custom numeric cap', () => {
    expect(resolveEffectiveMonthlyLimit({ monthlyLimitCost: 2 })).toEqual({
      isDefault: false,
      monthlyLimitCost: 2,
      unlimited: false,
    });
  });
});

describe('isModelAllowed', () => {
  it('allows everything when allowlist is null/undefined', () => {
    expect(isModelAllowed(null, 'openai', 'gpt-4o')).toBe(true);
    expect(isModelAllowed(undefined, 'openai', 'gpt-4o')).toBe(true);
  });

  it('blocks everything when allowlist is empty', () => {
    expect(isModelAllowed([], 'openai', 'gpt-4o')).toBe(false);
  });

  it('matches provider+model case-insensitively on provider', () => {
    expect(isModelAllowed([{ model: 'gpt-4o', provider: 'OpenAI' }], 'openai', 'gpt-4o')).toBe(
      true,
    );
    expect(isModelAllowed([{ model: 'gpt-4o', provider: 'openai' }], 'openai', 'gpt-4o-mini')).toBe(
      false,
    );
  });
});

describe('modelKey', () => {
  it('normalizes provider casing', () => {
    expect(modelKey('OpenAI', 'gpt-4o')).toBe(modelKey('openai', 'gpt-4o'));
  });
});
