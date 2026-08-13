import type { ChatModelCard } from '@lobechat/types';
import type OpenAI from 'openai';

import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

const DEFAULT_DEEPSEEK_OPENAI_BASE_URL = 'https://api.deepseek.com/v1';

interface DeepSeekModelCard {
  id: string;
}

interface OpenAIModelsClient {
  models: { list: () => Promise<{ data?: DeepSeekModelCard[] }> };
}

const isOpenAIModelsClient = (client: unknown): client is OpenAIModelsClient => {
  if (!client || typeof client !== 'object') return false;
  const maybe = client as { chat?: unknown; models?: { list?: unknown } };
  // Anthropic SDK also exposes models.list, but DeepSeek's Anthropic path
  // has no /v1/models. Only trust an OpenAI-compatible client.
  return typeof maybe.models?.list === 'function' && Boolean(maybe.chat);
};

const resolveDeepSeekOpenAIModelsBaseURL = (baseURL?: string) => {
  if (!baseURL) return DEFAULT_DEEPSEEK_OPENAI_BASE_URL;
  if (/\/anthropic\/?$/.test(baseURL) || /\/v1\/messages\/?$/.test(baseURL)) {
    return DEFAULT_DEEPSEEK_OPENAI_BASE_URL;
  }
  return baseURL.replace(/\/$/, '');
};

export const fetchDeepSeekModels = async ({
  apiKey: rawApiKey,
  baseURL: rawBaseURL,
  client,
  options,
}: {
  apiKey?: string;
  baseURL?: string;
  client: OpenAI | unknown;
  options?: { apiKey?: string; baseURL?: string };
}): Promise<ChatModelCard[]> => {
  if (isOpenAIModelsClient(client)) {
    const modelsPage = await client.models.list();
    return processModelList(modelsPage.data || [], MODEL_LIST_CONFIGS.deepseek, 'deepseek');
  }

  const apiKey =
    rawApiKey ||
    options?.apiKey ||
    (typeof client === 'object' && client && 'apiKey' in client
      ? String((client as { apiKey?: string }).apiKey ?? '')
      : '');

  if (apiKey) {
    const baseURL = resolveDeepSeekOpenAIModelsBaseURL(rawBaseURL || options?.baseURL);
    const response = await fetch(`${baseURL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch DeepSeek models: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as { data?: DeepSeekModelCard[] };
    return processModelList(json.data || [], MODEL_LIST_CONFIGS.deepseek, 'deepseek');
  }

  const { deepseek } = await import('model-bank');

  return processModelList(deepseek, MODEL_LIST_CONFIGS.deepseek, 'deepseek');
};
