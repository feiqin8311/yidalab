import type { ModelProviderCard } from '@/types/llm';

// ref: https://cloud.baidu.com/product/codingplan.html
const QianfanTokenPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'qianfan-code-latest',
  description:
    'Baidu Qianfan Token Plan (Personal) provides subscription access to GLM, DeepSeek, and Kimi models via a dedicated endpoint. Use qianfan-code-latest to follow the console Auto switch, or pick a model id directly.',
  disableBrowserRequest: true,
  id: 'qianfantokenplan',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://cloud.baidu.com/product/codingplan.html',
  name: 'Qianfan Token Plan',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://qianfan.baidubce.com/v2/tokenplan/personal',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showDeployName: true,
    showModelFetcher: false,
  },
  url: 'https://cloud.baidu.com/product/codingplan.html',
};

export default QianfanTokenPlan;
