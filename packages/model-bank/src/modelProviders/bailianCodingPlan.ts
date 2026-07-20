import type { ModelProviderCard } from '@/types/llm';

// Coding Plan: https://help.aliyun.com/zh/model-studio/coding-plan-overview
// Token Plan (includes image models): https://help.aliyun.com/zh/model-studio/token-plan-overview
const BailianCodingPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'qwen3.7-plus',
  description:
    'Aliyun Bailian Coding Plan / Token Plan provides subscription access to Qwen, GLM, Kimi, MiniMax, DeepSeek and image models (Token Plan) via a dedicated endpoint.',
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
