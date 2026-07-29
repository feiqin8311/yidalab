import type { ModelProviderCard } from '@/types/llm';

// ref: https://www.volcengine.com/docs/82379/1928261
const VolcengineCodingPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'doubao-seed-2.1-turbo',
  description:
    'Volcengine Coding Plan from ByteDance provides access to multiple coding models including Doubao-Seed-2.1-Turbo, GLM-5.2, DeepSeek-V4, MiniMax-M3, and Kimi-K2.7-Code via a fixed-fee subscription.',
  disableBrowserRequest: true,
  id: 'volcenginecodingplan',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://www.volcengine.com/docs/82379/1928261',
  name: 'Volcengine Coding Plan',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showDeployName: true,
    showModelFetcher: false,
  },
  url: 'https://www.volcengine.com/activity/codingplan',
};

export default VolcengineCodingPlan;
