import type { ModelProviderCard } from '@/types/llm';

const DeepSeek: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-v4-flash',
  description:
    'DeepSeek focuses on AI research and applications. The V4 family is now generally available: V4 Flash (0731) and V4 Pro (0813), both with a 1M context window, hybrid thinking, and native Responses API.',
  enabled: true,
  id: 'deepseek',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://platform.deepseek.com/api-docs/zh-cn/quick_start/pricing',
  name: 'DeepSeek',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.deepseek.com',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://deepseek.com',
};

export default DeepSeek;
