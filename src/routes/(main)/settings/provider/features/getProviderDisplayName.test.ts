import { describe, expect, it } from 'vitest';

import { getProviderDisplayName } from './getProviderDisplayName';

describe('getProviderDisplayName', () => {
  it('returns the configured provider name', () => {
    expect(getProviderDisplayName({ id: 'sub2api-openai', name: 'Sub2API OpenAI' })).toBe(
      'Sub2API OpenAI',
    );
  });

  it.each([undefined, '', '   '])('falls back to the provider id when name is %j', (name) => {
    expect(getProviderDisplayName({ id: 'sub2api-openai', name })).toBe('sub2api-openai');
  });
});
