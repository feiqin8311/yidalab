import type { ModelProviderCard } from '@/types/llm';

// Coding Plan: https://help.aliyun.com/zh/model-studio/coding-plan-overview
// Token Plan (includes image models): https://help.aliyun.com/zh/model-studio/token-plan-overview
const BailianCodingPlan: ModelProviderCard = {
  chatModels: [],
  // Keep a widely available plan model for connectivity checks; 3.8 preview is Token Plan-only.
  checkModel: 'qwen3.7-plus',
  description:
    'Aliyun Bailian Coding Plan / Token Plan provides subscription access to Qwen (incl. qwen3.8-max-preview on Token Plan), GLM, Kimi, MiniMax, DeepSeek and image models via a dedicated endpoint.',
  disableBrowserRequest: true,
  id: 'bailiancodingplan',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://help.aliyun.com/zh/model-studio/token-plan-overview',
  name: 'Aliyun Bailian Coding Plan',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      // Token Plan default; Coding Plan users can switch to coding.dashscope.aliyuncs.com/v1
      placeholder: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showDeployName: true,
    showModelFetcher: false,
  },
  url: 'https://help.aliyun.com/zh/model-studio/token-plan-overview',
};

export default BailianCodingPlan;
