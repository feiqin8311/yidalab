import { type AIChatModelCard } from '../types/aiModel';

// ref: https://www.volcengine.com/docs/82379/1928261
// model list: https://www.volcengine.com/docs/82379/2578683

const volcengineCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-2.1-turbo balances efficiency and performance for coding, agentic planning, and multimodal tasks with stronger autonomous planning and long-chain execution.',
    displayName: 'Doubao Seed 2.1 Turbo',
    enabled: true,
    family: 'doubao',
    generation: 'doubao-2.1',
    id: 'doubao-seed-2.1-turbo',
    maxOutput: 128_000,
    releasedAt: '2026-07-23',
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-2.0-lite is a multimodal deep-reasoning model that delivers better value for common coding and production tasks, with a context window up to 256k.',
    displayName: 'Doubao Seed 2.0 Lite',
    enabled: true,
    family: 'doubao',
    generation: 'doubao-2.0',
    id: 'doubao-seed-2.0-lite',
    maxOutput: 128_000,
    releasedAt: '2026-03-06',
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      "MiniMax M3 is MiniMax's multimodal flagship model with native image and video understanding, coding, and agentic capabilities.",
    displayName: 'MiniMax M3',
    enabled: true,
    family: 'minimax',
    generation: 'minimax-m3',
    id: 'minimax-m3',
    maxOutput: 128_000,
    organization: 'MiniMax',
    releasedAt: '2026-06-08',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'MiniMax M2.7: Beginning the journey of recursive self-improvement, top real-world engineering capabilities.',
    displayName: 'MiniMax M2.7',
    enabled: true,
    family: 'minimax',
    generation: 'minimax-m2.7',
    id: 'minimax-m2.7',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2026-04-22',
    type: 'chat',
  },
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
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      "DeepSeek-V4-Pro is DeepSeek's flagship MoE model, supporting both non-thinking and thinking modes for advanced reasoning, code generation, and complex agent workflows.",
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro',
    maxOutput: 393_216,
    organization: 'DeepSeek',
    releasedAt: '2026-05-18',
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
    contextWindowTokens: 1_048_576,
    description:
      "DeepSeek-V4-Flash is DeepSeek's efficient 1M-context model, balancing speed and cost while keeping strong reasoning and agent capabilities.",
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash',
    maxOutput: 393_216,
    organization: 'DeepSeek',
    releasedAt: '2026-05-18',
    settings: {
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.7 Code: coding-focused Kimi model that follows instructions more reliably in long context, with text/image/video input and thinking mode.',
    displayName: 'Kimi K2.7 Code',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'kimi-k2.7-code',
    maxOutput: 32_768,
    organization: 'Moonshot',
    releasedAt: '2026-06-18',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.6: strong multi-step tool use and reasoning for complex logic, math, and coding tasks.',
    displayName: 'Kimi K2.6',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.6',
    id: 'kimi-k2.6',
    maxOutput: 32_768,
    organization: 'Moonshot',
    releasedAt: '2026-04-22',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
];

export default volcengineCodingPlanChatModels;
