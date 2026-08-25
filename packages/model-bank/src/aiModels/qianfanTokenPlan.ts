import { type AIChatModelCard } from '../types/aiModel';

// Token Plan Personal: https://cloud.baidu.com/product/codingplan.html
// API model switch: qianfan-code-latest follows the console Auto mapping (~1 min).

const qianfanTokenPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Auto: intelligent routing that matches the best-performing model. Switch the backing model in the Qianfan console; changes take about 1 minute.',
    displayName: 'Auto',
    enabled: true,
    family: 'qianfan',
    id: 'qianfan-code-latest',
    maxOutput: 65_536,
    organization: 'Qianfan',
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
    contextWindowTokens: 1_000_000,
    description:
      "GLM-5.2 is Zhipu's flagship model for long-horizon agentic engineering, with a usable 1M-token context window. Off-peak tokens are billed at 20%.",
    displayName: 'GLM-5.2',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.2',
    id: 'glm-5.2',
    maxOutput: 131_072,
    organization: 'Zhipu',
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
      "GLM-5.1 is Zhipu's latest flagship with stronger coding and long-horizon delivery for engineering-grade results.",
    displayName: 'GLM-5.1',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.1',
    id: 'glm-5.1',
    maxOutput: 131_072,
    organization: 'Zhipu',
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
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek-V4-Pro supports million-token context, with leading agent, world-knowledge, and reasoning performance. Off-peak tokens are billed at 20%.',
    displayName: 'DeepSeek-V4-Pro',
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
      'DeepSeek-V4-Flash is a lightweight V4 model with million-token context. Off-peak tokens are billed at 20%.',
    displayName: 'DeepSeek-V4-Flash',
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
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi-K2.6 has stronger, more stable long-horizon coding, and accepts text and image input.',
    displayName: 'Kimi-K2.6',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.6',
    id: 'kimi-k2.6',
    maxOutput: 98_304,
    organization: 'Moonshot',
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
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek-V4-Pro-0813 is the GA DeepSeek-V4-Pro (1.8x deduction). Stronger agents and better production performance than the preview.',
    displayName: 'DeepSeek-V4-Pro-0813',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro-0813',
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
      'DeepSeek-V4-Flash-0731 is the official DeepSeek-V4-Flash, replacing the preview with stronger agentic ability.',
    displayName: 'DeepSeek-V4-Flash-0731',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash-0731',
    maxOutput: 393_216,
    organization: 'DeepSeek',
    settings: {
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
];

export default qianfanTokenPlanChatModels;
