import { describe, expect, it } from 'vitest';

import type { AgentState } from '../types';
import {
  applyMaxTotalTokensBrake,
  applyToolFailStreakBrake,
  extractToolErrorMessage,
} from './runBrakes';

const baseState = (): AgentState =>
  ({
    cost: {
      calculatedAt: '',
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    createdAt: '',
    lastModified: '',
    messages: [],
    operationId: 'op',
    status: 'running',
    stepCount: 1,
    usage: {
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
      llm: { apiCalls: 1, processingTimeMs: 0, tokens: { input: 100, output: 50, total: 150 } },
      tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
    },
  }) as AgentState;

describe('applyMaxTotalTokensBrake', () => {
  it('force-finishes when total tokens hit the cap', () => {
    const state = baseState();
    state.maxTotalTokens = 100;
    applyMaxTotalTokensBrake(state);
    expect(state.forceFinish).toBe(true);
    expect(state.metadata?.runBrakeReason).toContain('Token limit');
  });

  it('no-ops under the cap', () => {
    const state = baseState();
    state.maxTotalTokens = 10_000;
    applyMaxTotalTokensBrake(state);
    expect(state.forceFinish).toBeUndefined();
  });
});

describe('applyToolFailStreakBrake', () => {
  it('force-finishes after N consecutive failures', () => {
    const state = baseState();
    state.toolFailStreakLimit = 2;
    applyToolFailStreakBrake(state, {
      errorMessage: 'MARKET_AUTH_REQUIRED',
      isSuccess: false,
      toolName: 'sandbox.writeFile',
    });
    expect(state.forceFinish).toBeUndefined();
    applyToolFailStreakBrake(state, {
      errorMessage: 'MARKET_AUTH_REQUIRED',
      isSuccess: false,
      toolName: 'sandbox.writeFile',
    });
    expect(state.forceFinish).toBe(true);
  });
});

describe('extractToolErrorMessage', () => {
  it('reads error message object', () => {
    expect(extractToolErrorMessage({ error: { message: 'boom' } })).toBe('boom');
  });
});
