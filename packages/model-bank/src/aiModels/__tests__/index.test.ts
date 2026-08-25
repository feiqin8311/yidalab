import { describe, expect, it, vi } from 'vitest';

import { ModelProvider } from '../../const/modelProvider';
import { loadModels, LOBE_DEFAULT_MODEL_LIST } from '../index';

describe('loadModels', () => {
  it('returns the static model list by default', async () => {
    await expect(loadModels()).resolves.toBe(LOBE_DEFAULT_MODEL_LIST);
  });

  it('overrides provider models with injected async loaders', async () => {
    const loader = vi.fn().mockResolvedValue([
      {
        enabled: true,
        id: 'injected-lobehub-model',
        type: 'chat',
      },
    ]);

    const models = await loadModels({
      providerLoaders: {
        [ModelProvider.LobeHub]: loader,
      },
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enabled: true,
          id: 'injected-lobehub-model',
          providerId: ModelProvider.LobeHub,
          source: 'builtin',
          type: 'chat',
        }),
      ]),
    );
  });

  it('ignores undefined provider loaders', async () => {
    await expect(
      loadModels({
        providerLoaders: {
          [ModelProvider.LobeHub]: undefined,
        },
      }),
    ).resolves.toBe(LOBE_DEFAULT_MODEL_LIST);
  });

  it('propagates injected loader errors without falling back to static models', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('model config missing'));

    await expect(
      loadModels({
        providerLoaders: {
          [ModelProvider.LobeHub]: loader,
        },
      }),
    ).rejects.toThrow('model config missing');
  });
});

describe('knowledgeCutoff backfill', () => {
  it('fills knowledgeCutoff from the canonical map for builtin models', () => {
    const minimaxM3 = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === 'minimaxcodingplan' && m.id === 'MiniMax-M3',
    );
    expect(minimaxM3?.enabled).toBe(true);

    const qianfanAuto = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === 'qianfantokenplan' && m.id === 'qianfan-code-latest',
    );
    expect(qianfanAuto).toMatchObject({
      displayName: 'Auto',
      enabled: true,
    });

    const glm52 = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === 'glmcodingplan' && m.id === 'GLM-5.2',
    );
    expect(glm52).toMatchObject({
      contextWindowTokens: 1_000_000,
      enabled: true,
      maxOutput: 131_072,
    });

    const zhipuGlm52 = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === 'zhipu' && m.id === 'glm-5.2',
    );
    expect(zhipuGlm52).toMatchObject({
      contextWindowTokens: 1_000_000,
      enabled: true,
      maxOutput: 131_072,
    });

    const fable = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === 'anthropic' && m.id === 'claude-fable-5',
    );
    expect(fable?.knowledgeCutoff).toBe('2026-01');

    const opus = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === 'anthropic' && m.id === 'claude-opus-4-8',
    );
    expect(opus?.knowledgeCutoff).toBe('2026-01');

    // aggregator spelling of the same model gets the same cutoff
    const bedrockOpus = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === 'bedrock' && m.id === 'global.anthropic.claude-opus-4-7',
    );
    expect(bedrockOpus?.knowledgeCutoff).toBe('2026-01');

    const vertexGemini3Pro = LOBE_DEFAULT_MODEL_LIST.find(
      (m) => m.providerId === 'vertexai' && m.id === 'gemini-3-pro-preview',
    );
    expect(vertexGemini3Pro?.knowledgeCutoff).toBe('2025-01');
  });

  it('keeps an explicit knowledgeCutoff over the map value', async () => {
    const loader = vi.fn().mockResolvedValue([
      { enabled: true, id: 'gpt-5', knowledgeCutoff: '2020-01', type: 'chat' },
      { enabled: true, id: 'gpt-5-mini', type: 'chat' },
    ]);

    const models = await loadModels({
      providerLoaders: { [ModelProvider.LobeHub]: loader },
    });

    const lobehubModels = models.filter((m) => m.providerId === ModelProvider.LobeHub);
    expect(lobehubModels.find((m) => m.id === 'gpt-5')?.knowledgeCutoff).toBe('2020-01');
    expect(lobehubModels.find((m) => m.id === 'gpt-5-mini')?.knowledgeCutoff).toBe('2024-05');
  });
});
