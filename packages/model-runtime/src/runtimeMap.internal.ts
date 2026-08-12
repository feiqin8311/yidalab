/**
 * YidaLab internal provider runtime map.
 * Aliased over `./runtimeMap.ts` when YIDALAB_BUILD_PROFILE=internal.
 */
import { LobeAnthropicAI } from './providers/anthropic';
import { LobeAzureAI } from './providers/azureai';
import { LobeAzureOpenAI } from './providers/azureOpenai';
import { LobeBedrockAI } from './providers/bedrock';
import { LobeDeepSeekAI } from './providers/deepseek';
import { LobeGoogleAI } from './providers/google';
import { LobeGroq } from './providers/groq';
import { LobeMinimaxAI } from './providers/minimax';
import { LobeMoonshotAI } from './providers/moonshot';
import { LobeOllamaAI } from './providers/ollama';
import { LobeOpenAI } from './providers/openai';
import { LobeOpenRouterAI } from './providers/openrouter';
import { LobeQwenAI } from './providers/qwen';
import { LobeSiliconCloudAI } from './providers/siliconcloud';
import { LobeVolcengineAI } from './providers/volcengine';
import { LobeXAI } from './providers/xai';
import { LobeZhipuAI } from './providers/zhipu';

export const providerRuntimeMap = {
  anthropic: LobeAnthropicAI,
  azure: LobeAzureOpenAI,
  azureai: LobeAzureAI,
  bedrock: LobeBedrockAI,
  deepseek: LobeDeepSeekAI,
  google: LobeGoogleAI,
  groq: LobeGroq,
  minimax: LobeMinimaxAI,
  moonshot: LobeMoonshotAI,
  ollama: LobeOllamaAI,
  openai: LobeOpenAI,
  openrouter: LobeOpenRouterAI,
  qwen: LobeQwenAI,
  siliconcloud: LobeSiliconCloudAI,
  volcengine: LobeVolcengineAI,
  xai: LobeXAI,
  zhipu: LobeZhipuAI,
};
