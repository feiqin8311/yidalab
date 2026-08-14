import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { resolveServerCallLlmContextHints } from './serverCallLlmContextHints';

const mockLoadModels = vi.hoisted(() => vi.fn());
const mockFindByIdAndProvider = vi.hoisted(() => vi.fn());

vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadModels: mockLoadModels,
}));

vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: vi.fn().mockImplementation(() => ({
    findByIdAndProvider: mockFindByIdAndProvider,
  })),
}));

const gpt55Card = {
  contextWindowTokens: 1_050_000,
  displayName: 'GPT-5.5',
  id: 'gpt-5.5',
  knowledgeCutoff: '2025-12',
  providerId: 'openai',
};

const payload = {
  messages: [{ content: 'hello', role: 'user' }],
  model: 'gpt-5.5',
  provider: 'sub2api-openai',
};

const ctx = {
  agentConfig: {},
  operationCache: new Map(),
  serverDB: {} as any,
  userId: 'user-1',
  workspaceId: 'ws-1',
} as unknown as RuntimeExecutorContext;

describe('resolveServerCallLlmContextHints context window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctx.operationCache = new Map();
    mockLoadModels.mockResolvedValue([gpt55Card]);
    mockFindByIdAndProvider.mockResolvedValue(null);
  });

  it('inherits the canonical model window for custom OpenAI-compatible providers', async () => {
    const hints = await resolveServerCallLlmContextHints({
      ctx,
      llmPayload: payload as any,
      model: 'gpt-5.5',
      provider: 'sub2api-openai',
    });

    expect(hints.contextWindowTokens).toBe(1_050_000);
    expect(hints.modelKnowledgeCutoff).toBeUndefined();
  });

  it('prefers a user-record window over the canonical card', async () => {
    mockFindByIdAndProvider.mockResolvedValue({ contextWindowTokens: 200_000 });

    const hints = await resolveServerCallLlmContextHints({
      ctx,
      llmPayload: payload as any,
      model: 'gpt-5.5',
      provider: 'sub2api-openai',
    });

    expect(hints.contextWindowTokens).toBe(200_000);
  });

  it('uses the provider-scoped card when one exists', async () => {
    mockLoadModels.mockResolvedValue([
      gpt55Card,
      { ...gpt55Card, contextWindowTokens: 272_000, providerId: 'sub2api-openai' },
    ]);

    const hints = await resolveServerCallLlmContextHints({
      ctx,
      llmPayload: payload as any,
      model: 'gpt-5.5',
      provider: 'sub2api-openai',
    });

    expect(hints.contextWindowTokens).toBe(272_000);
  });
});
