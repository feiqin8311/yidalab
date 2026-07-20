import { ModelProvider } from 'model-bank';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import { QwenAIStream } from '../../core/streams';
import type { CreateImagePayload } from '../../types/image';
import { processMultiProviderModelList } from '../../utils/modelParse';
import { createQwenImage } from '../qwen/createImage';

/**
 * Normalize chat baseURL so createQwenImage can derive the native AIGC host.
 * - Token Plan: https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
 * - Coding Plan: https://coding.dashscope.aliyuncs.com/v1
 */
const normalizeBailianImageBaseURL = (baseURL?: string) => {
  if (!baseURL) return baseURL;
  if (baseURL.includes('/compatible-mode/v1')) return baseURL;
  // strip trailing /v1 so createQwenImage treats the host root as dashscopeURL
  return baseURL.replace(/\/v1\/?$/, '');
};

export const LobeBailianCodingPlanAI = createOpenAICompatibleRuntime({
  baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { model, presence_penalty, temperature, thinking, top_p, ...rest } = payload;

      const resolvedParams = resolveParameters(
        { presence_penalty, temperature, top_p },
        {
          normalizeTemperature: false,
          presencePenaltyRange: { max: 2, min: -2 },
          temperatureRange: { max: 2, min: 0 },
          topPRange: { max: 1, min: 0 },
        },
      );

      return {
        ...rest,
        ...(thinking?.type === 'enabled' &&
          thinking?.budget_tokens !== 0 && {
            enable_thinking: true,
            thinking_budget: thinking?.budget_tokens || undefined,
          }),
        frequency_penalty: undefined,
        model,
        presence_penalty: resolvedParams.presence_penalty,
        stream: true,
        temperature: resolvedParams.temperature,
        top_p: resolvedParams.top_p,
        ...(payload.tools && {
          parallel_tool_calls: true,
        }),
      } as any;
    },
    handleStream: QwenAIStream,
  },
  createImage: (payload: CreateImagePayload, options: CreateImageOptions) =>
    createQwenImage(payload, {
      ...options,
      baseURL: normalizeBailianImageBaseURL(options.baseURL),
    }),
  debug: {
    chatCompletion: () => process.env.DEBUG_BAILIAN_CODING_PLAN_CHAT_COMPLETION === '1',
  },
  // Coding Plan / Token Plan do NOT support fetching model list via API
  models: async () => {
    const { bailiancodingplan } = await import('model-bank');
    return processMultiProviderModelList(
      bailiancodingplan.map((m: { id: string }) => ({ id: m.id })),
      'bailiancodingplan',
    );
  },
  provider: ModelProvider.BailianCodingPlan,
});
