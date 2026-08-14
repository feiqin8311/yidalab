import { describe, expect, it } from 'vitest';

import { buildModelFailoverPool } from './modelFailoverPool';

describe('buildModelFailoverPool', () => {
  it('uses enabled chat models and diversifies providers before remaining siblings', () => {
    const result = buildModelFailoverPool({
      enabledModels: [
        { id: 'primary', providerId: 'openai', type: 'chat' },
        { id: 'openai-backup', providerId: 'openai', type: 'chat' },
        { id: 'openai-later', providerId: 'openai', type: 'chat' },
        { id: 'claude-1', providerId: 'anthropic', type: 'chat' },
        { id: 'claude-2', providerId: 'anthropic', type: 'chat' },
        { id: 'gemini-1', providerId: 'google', type: 'chat' },
        { id: 'image-model', providerId: 'google', type: 'image' },
      ],
      enabledProviderIds: ['openai', 'anthropic', 'google'],
      primary: { model: 'primary', provider: 'openai' },
      requiresFunctionCall: false,
    });

    expect(result).toEqual([
      { model: 'openai-backup', provider: 'openai' },
      { model: 'claude-1', provider: 'anthropic' },
      { model: 'gemini-1', provider: 'google' },
      { model: 'openai-later', provider: 'openai' },
      { model: 'claude-2', provider: 'anthropic' },
    ]);
  });

  it('honors model access and excludes explicitly tool-incompatible candidates', () => {
    const result = buildModelFailoverPool({
      enabledModels: [
        {
          abilities: { functionCall: false },
          id: 'no-tools',
          providerId: 'openai',
          type: 'chat',
        },
        {
          abilities: { functionCall: true },
          id: 'allowed-tools',
          providerId: 'anthropic',
          type: 'chat',
        },
        { id: 'blocked-custom', providerId: 'google', type: 'chat' },
      ],
      enabledProviderIds: ['openai', 'anthropic', 'google'],
      isAllowed: ({ model }) => model !== 'blocked-custom',
      primary: { model: 'primary', provider: 'openai' },
      requiresFunctionCall: true,
    });

    expect(result).toEqual([{ model: 'allowed-tools', provider: 'anthropic' }]);
  });
});
