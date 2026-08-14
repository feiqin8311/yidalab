import type {
  AgentState,
  ContextBuildOutput,
  LLMAttemptOutput,
  LLMTurnFailoverInput,
} from '@lobechat/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

import { CompanyQuotaDeniedError } from '@/server/services/companyQuota';

import type { RuntimeExecutorContext } from '../context';
import { openServerCallLlmTurn } from './serverCallLlmExecutor';

const output: LLMAttemptOutput = {
  answerSalvagedFromReasoning: false,
  content: '',
  contentParts: [],
  grounding: null,
  hasContentImages: false,
  hasReasoningImages: false,
  imageList: [],
  reasoningParts: [],
  thinkingContent: '',
  toolCalls: [],
  toolsCalling: [],
};

const state = {
  metadata: { topicId: 'topic-1' },
} as unknown as AgentState;

const createContext = (marker: string) =>
  ({
    messages: [{ content: marker, role: 'user' }],
    replayAssistantReasoning: false,
    resolvedTools: { tools: [] },
  }) as unknown as ContextBuildOutput;

const failoverInput = (code: string, kind: 'retry' | 'stop'): LLMTurnFailoverInput => ({
  attempt: 1,
  error: new Error(code),
  errorInfo: { code, kind, message: code },
  events: [],
  output,
  retryBudget: 0,
});

describe('ServerCallLlmTurnSession model failover', () => {
  it('rebuilds candidate context and dispatches the next attempt to the fallback runtime', async () => {
    const primary = { model: 'primary', provider: 'provider-a' };
    const fallback = { model: 'fallback', provider: 'provider-b' };
    const fallbackContext = createContext('fallback-context');
    const loadCandidates = vi.fn().mockResolvedValue([primary, fallback]);
    const prepareCandidate = vi.fn().mockResolvedValue(fallbackContext);
    const runAttempt = vi.fn().mockResolvedValue({ ok: true, output });
    const session = openServerCallLlmTurn(
      { operationId: 'op-1', stepIndex: 0, stream: true } as RuntimeExecutorContext,
      {
        assistantMessage: { id: 'message-1' },
        candidates: [primary],
        context: createContext('primary-context'),
        loadCandidates,
        model: primary.model,
        prepareCandidate,
        provider: primary.provider,
        runAttempt,
        state,
      },
    );

    await expect(
      session.tryFailover?.(failoverInput('ProviderServiceUnavailable', 'retry')),
    ).resolves.toEqual({
      candidateIndex: 2,
      from: primary,
      to: fallback,
      totalCandidates: 2,
    });
    await session.runAttempt({ attempt: 2, events: [] });

    expect(prepareCandidate).toHaveBeenCalledWith(fallback);
    expect(loadCandidates).toHaveBeenCalledOnce();
    expect(runAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        context: fallbackContext,
        model: fallback.model,
        provider: fallback.provider,
      }),
    );
    expect(session.resolveRetryBudget(new Error('fallback unavailable'))).toBe(0);
    expect(session.getCurrentCandidate?.()).toEqual(fallback);
    session.close();
  });

  it('does not switch models for content policy failures', async () => {
    const primary = { model: 'primary', provider: 'provider-a' };
    const loadCandidates = vi
      .fn()
      .mockResolvedValue([primary, { model: 'fallback', provider: 'provider-b' }]);
    const prepareCandidate = vi.fn();
    const session = openServerCallLlmTurn(
      { operationId: 'op-1', stepIndex: 0 } as RuntimeExecutorContext,
      {
        assistantMessage: { id: 'message-1' },
        candidates: [primary],
        context: createContext('primary-context'),
        loadCandidates,
        model: primary.model,
        prepareCandidate,
        provider: primary.provider,
        runAttempt: vi.fn(),
        state,
      },
    );

    await expect(session.tryFailover?.(failoverInput('ContentModeration', 'stop'))).resolves.toBe(
      undefined,
    );
    expect(loadCandidates).not.toHaveBeenCalled();
    expect(prepareCandidate).not.toHaveBeenCalled();
    session.close();
  });

  it('switches immediately when a stale primary is outside the company model allowlist', async () => {
    const primary = { model: 'primary', provider: 'provider-a' };
    const fallback = { model: 'allowed', provider: 'provider-b' };
    const quotaError = new CompanyQuotaDeniedError('model_not_allowed');
    const session = openServerCallLlmTurn(
      { operationId: 'op-1', stepIndex: 0 } as RuntimeExecutorContext,
      {
        assistantMessage: { id: 'message-1' },
        candidates: [primary],
        context: createContext('primary-context'),
        loadCandidates: vi.fn().mockResolvedValue([primary, fallback]),
        model: primary.model,
        prepareCandidate: vi.fn().mockResolvedValue(createContext('fallback-context')),
        provider: primary.provider,
        runAttempt: vi.fn(),
        state,
      },
    );

    expect(session.resolveRetryBudget(quotaError)).toBe(0);
    await expect(
      session.tryFailover?.({
        ...failoverInput('Forbidden', 'stop'),
        error: quotaError,
        errorInfo: { kind: 'stop', message: quotaError.message },
      }),
    ).resolves.toEqual({
      candidateIndex: 2,
      from: primary,
      to: fallback,
      totalCandidates: 2,
    });
    session.close();
  });
});
