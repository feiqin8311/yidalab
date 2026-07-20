import { type AIChatModelCard, type AIImageModelCard } from '../types/aiModel';

// Token Plan / Coding Plan models for Aliyun Bailian
// Token Plan model whitelist: https://help.aliyun.com/zh/model-studio/token-plan-overview
// Coding Plan: https://help.aliyun.com/zh/model-studio/coding-plan-overview

const bailianCodingPlanChatModels: AIChatModelCard[] = [
  // ---- Qwen ----
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.7 Plus: multimodal interactive hybrid agent model for GUI operation, visual coding, and complex agentic workflows.',
    displayName: 'Qwen3.7 Plus',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.7',
    id: 'qwen3.7-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    releasedAt: '2026-06-01',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken80k'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.7 Max: flagship model with strong reasoning, function calling, and agent task performance.',
    displayName: 'Qwen3.7 Max',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.7',
    id: 'qwen3.7-max',
    maxOutput: 65_536,
    organization: 'Qwen',
    releasedAt: '2026-05-20',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken80k', 'preserveThinking'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.6 Plus supports text, image, and video input, with balanced quality, speed, and cost for coding and agent workflows.',
    displayName: 'Qwen3.6 Plus',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'qwen3.6-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    releasedAt: '2026-04-02',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken80k'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.6 Flash: faster vision-language Flash model with improved agentic coding and mathematical reasoning.',
    displayName: 'Qwen3.6 Flash',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'qwen3.6-flash',
    maxOutput: 65_536,
    organization: 'Qwen',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken80k'],
    },
    type: 'chat',
  },

  // ---- DeepSeek ----
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Pro: flagship V4 model for high-intensity reasoning and agentic workflows with a 1M context window.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro',
    maxOutput: 393_216,
    organization: 'DeepSeek',
    settings: {
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Flash: faster V4 variant optimized for cost-efficient coding and agent tasks.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash',
    maxOutput: 393_216,
    organization: 'DeepSeek',
    settings: {
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek V3.2 introduces sparse attention for efficient long-text training and inference.',
    displayName: 'DeepSeek V3.2',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v3.2',
    id: 'deepseek-v3.2',
    maxOutput: 65_536,
    organization: 'DeepSeek',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },

  // ---- Kimi ----
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.7 Code: coding-optimized Kimi model with reasoning and vision understanding.',
    displayName: 'Kimi K2.7 Code',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'kimi-k2.7-code',
    maxOutput: 98_304,
    organization: 'Moonshot',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.6: large language model with strong coding and tool-calling capabilities.',
    displayName: 'Kimi K2.6',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.6',
    id: 'kimi-k2.6',
    maxOutput: 98_304,
    organization: 'Moonshot',
    releasedAt: '2026-04-21',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.5: native multimodal architecture supporting vision and text, thinking/non-thinking modes, conversational and agent tasks.',
    displayName: 'Kimi K2.5',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.5',
    id: 'kimi-k2.5',
    maxOutput: 32_768,
    organization: 'Moonshot',
    releasedAt: '2026-01-27',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },

  // ---- Zhipu GLM ----
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      "GLM-5.2 is Zhipu's flagship model for long-horizon agentic engineering, with a 1M-token context window for project-scale coding tasks.",
    displayName: 'GLM-5.2',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.2',
    id: 'glm-5.2',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2026-06-17',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken32k'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 202_745,
    description:
      "GLM-5.1 is Zhipu's flagship variant for long-horizon agentic engineering and complex development workflows.",
    displayName: 'GLM-5.1',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.1',
    id: 'glm-5.1',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2026-04-14',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken32k'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      "GLM-5 is Zhipu's next-generation flagship foundation model, purpose-built for Agentic Engineering.",
    displayName: 'GLM-5',
    enabled: true,
    family: 'glm',
    generation: 'glm-5',
    id: 'glm-5',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2026-02-12',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken32k'],
    },
    type: 'chat',
  },

  // ---- MiniMax ----
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description: 'MiniMax-M2.5: multi-language programming and complex agent task solving.',
    displayName: 'MiniMax-M2.5',
    enabled: true,
    family: 'minimax',
    generation: 'minimax-m2.5',
    id: 'MiniMax-M2.5',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2026-02-12',
    type: 'chat',
  },
];

// Token Plan image models (exact whitelist)
// https://help.aliyun.com/zh/model-studio/token-plan-overview
// https://help.aliyun.com/zh/model-studio/token-plan-multimodal-gen
const bailianCodingPlanImageModels: AIImageModelCard[] = [
  {
    description:
      'The Qwen-Image-2.0 series accelerated version model integrates image generation and image editing into a unified capability.',
    displayName: 'Qwen Image 2.0',
    enabled: true,
    id: 'qwen-image-2.0',
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 4096, min: 256, step: 1 },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 4096, min: 256, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    releasedAt: '2026-03-03',
    type: 'image',
  },
  {
    description:
      'The Qwen-Image-2.0 series full-version model integrates image generation and image editing into a unified capability.',
    displayName: 'Qwen Image 2.0 Pro',
    enabled: true,
    id: 'qwen-image-2.0-pro',
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 4096, min: 256, step: 1 },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 4096, min: 256, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    releasedAt: '2026-03-03',
    type: 'image',
  },
  {
    description: 'Wanxiang 2.7 Image, faster image generation speed.',
    displayName: 'Wanxiang2.7 Image',
    enabled: true,
    id: 'wan2.7-image',
    organization: 'Qwen',
    parameters: {
      height: { default: 2048, max: 5792, min: 271, step: 1 },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 2048, max: 5792, min: 271, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    releasedAt: '2026-04-01',
    type: 'image',
  },
  {
    description: 'Wanxiang 2.7 Image Professional Edition, supports 4K high-definition output.',
    displayName: 'Wanxiang2.7 Image Pro',
    enabled: true,
    id: 'wan2.7-image-pro',
    organization: 'Qwen',
    parameters: {
      height: { default: 2048, max: 11_585, min: 271, step: 1 },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 2048, max: 11_585, min: 271, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    releasedAt: '2026-04-01',
    type: 'image',
  },
];

export const allModels = [...bailianCodingPlanChatModels, ...bailianCodingPlanImageModels];

export default allModels;
