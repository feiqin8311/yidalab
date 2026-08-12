/**
 * YidaLab internal model provider catalog.
 * Aliased over `./index.ts` when YIDALAB_BUILD_PROFILE=internal.
 */
import type { ChatModelCard, ModelProviderCard } from '@/types/llm';

import AnthropicProvider from './anthropic';
import AzureProvider from './azure';
import AzureAIProvider from './azureai';
import BedrockProvider from './bedrock';
import DeepSeekProvider from './deepseek';
import GoogleProvider from './google';
import GroqProvider from './groq';
import MinimaxProvider from './minimax';
import MoonshotProvider from './moonshot';
import OllamaProvider from './ollama';
import OpenAIProvider from './openai';
import OpenRouterProvider from './openrouter';
import QwenProvider from './qwen';
import SiliconCloudProvider from './siliconcloud';
import VolcengineProvider from './volcengine';
import XAIProvider from './xai';
import ZhiPuProvider from './zhipu';

/**
 * @deprecated
 */
export const LOBE_DEFAULT_MODEL_LIST: ChatModelCard[] = [
  OpenAIProvider.chatModels,
  AnthropicProvider.chatModels,
  GoogleProvider.chatModels,
  DeepSeekProvider.chatModels,
  MoonshotProvider.chatModels,
  QwenProvider.chatModels,
  ZhiPuProvider.chatModels,
  BedrockProvider.chatModels,
  OllamaProvider.chatModels,
  OpenRouterProvider.chatModels,
  SiliconCloudProvider.chatModels,
  VolcengineProvider.chatModels,
  MinimaxProvider.chatModels,
  GroqProvider.chatModels,
  XAIProvider.chatModels,
].flat();

export const DEFAULT_MODEL_PROVIDER_LIST = [
  AnthropicProvider,
  GoogleProvider,
  OpenAIProvider,
  DeepSeekProvider,
  MoonshotProvider,
  BedrockProvider,
  { ...AzureProvider, chatModels: [] },
  AzureAIProvider,
  OpenRouterProvider,
  OllamaProvider,
  QwenProvider,
  ZhiPuProvider,
  SiliconCloudProvider,
  VolcengineProvider,
  MinimaxProvider,
  GroqProvider,
  XAIProvider,
];

export const filterEnabledModels = (provider: ModelProviderCard) => {
  return provider.chatModels.filter((v) => v.enabled).map((m) => m.id);
};

export const isProviderDisableBrowserRequest = (id: string) => {
  const provider = DEFAULT_MODEL_PROVIDER_LIST.find(
    (v) => v.id === id && (v.disableBrowserRequest || v.settings?.disableBrowserRequest),
  );
  return !!provider;
};

export { default as AnthropicProviderCard } from './anthropic';
export { default as AzureProviderCard } from './azure';
export { default as AzureAIProviderCard } from './azureai';
export { default as BedrockProviderCard } from './bedrock';
// Settings detail pages still import these by name even when not in the default list.
export { default as CloudflareProviderCard } from './cloudflare';
export { default as ComfyUIProviderCard } from './comfyui';
export { default as DeepSeekProviderCard } from './deepseek';
export { default as GithubProviderCard } from './github';
export { default as GoogleProviderCard } from './google';
export { default as GroqProviderCard } from './groq';
export { default as MinimaxProviderCard } from './minimax';
export { default as MoonshotProviderCard } from './moonshot';
export { default as NewAPIProviderCard } from './newapi';
export { default as OllamaProviderCard } from './ollama';
export { default as OpenAIProviderCard } from './openai';
export { default as OpenRouterProviderCard } from './openrouter';
export { default as QwenProviderCard } from './qwen';
export { default as SiliconCloudProviderCard } from './siliconcloud';
export { default as VertexAIProviderCard } from './vertexai';
export { default as VolcengineProviderCard } from './volcengine';
export { default as XAIProviderCard } from './xai';
export { default as ZhiPuProviderCard } from './zhipu';
