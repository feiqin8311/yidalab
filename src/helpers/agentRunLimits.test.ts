import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_AGENT_MAX_STEPS,
  DEFAULT_AGENT_MAX_TOTAL_TOKENS,
  DEFAULT_AGENT_TOOL_FAIL_STREAK,
  getAgentRunLimits,
  normalizeToolErrorSignature,
  toolFailStreakKey,
} from './agentRunLimits';

const KEYS = [
  'AGENT_MAX_STEPS',
  'AGENT_MAX_TOTAL_TOKENS',
  'AGENT_TOOL_FAIL_STREAK',
  'NEXT_PUBLIC_AGENT_MAX_STEPS',
  'NEXT_PUBLIC_AGENT_MAX_TOTAL_TOKENS',
  'NEXT_PUBLIC_AGENT_TOOL_FAIL_STREAK',
] as const;

const snapshot = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    const v = snapshot[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('getAgentRunLimits', () => {
  it('returns product defaults when env is unset', () => {
    for (const k of KEYS) delete process.env[k];
    expect(getAgentRunLimits()).toEqual({
      maxSteps: DEFAULT_AGENT_MAX_STEPS,
      maxTotalTokens: DEFAULT_AGENT_MAX_TOTAL_TOKENS,
      toolFailStreak: DEFAULT_AGENT_TOOL_FAIL_STREAK,
    });
  });

  it('reads AGENT_* env overrides', () => {
    process.env.AGENT_MAX_STEPS = '80';
    process.env.AGENT_MAX_TOTAL_TOKENS = '500000';
    process.env.AGENT_TOOL_FAIL_STREAK = '5';
    expect(getAgentRunLimits()).toEqual({
      maxSteps: 80,
      maxTotalTokens: 500_000,
      toolFailStreak: 5,
    });
  });

  it('ignores non-positive env values', () => {
    process.env.AGENT_MAX_STEPS = '0';
    process.env.AGENT_MAX_TOTAL_TOKENS = '-1';
    expect(getAgentRunLimits().maxSteps).toBe(DEFAULT_AGENT_MAX_STEPS);
    expect(getAgentRunLimits().maxTotalTokens).toBe(DEFAULT_AGENT_MAX_TOTAL_TOKENS);
  });
});

describe('normalizeToolErrorSignature', () => {
  it('collapses uuids and truncates', () => {
    const sig = normalizeToolErrorSignature(
      'MARKET_AUTH_REQUIRED id=a1b2c3d4-e5f6-7890-abcd-ef1234567890 extra noise '.repeat(5),
    );
    expect(sig).toContain('MARKET_AUTH_REQUIRED');
    expect(sig).toContain('<id>');
    expect(sig.length).toBeLessThanOrEqual(120);
  });
});

describe('toolFailStreakKey', () => {
  it('joins tool and signature', () => {
    expect(toolFailStreakKey('lobe-cloud-sandbox.writeFile', 'MARKET_AUTH_REQUIRED')).toBe(
      'lobe-cloud-sandbox.writeFile::MARKET_AUTH_REQUIRED',
    );
  });
});
