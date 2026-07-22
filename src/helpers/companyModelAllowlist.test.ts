import { describe, expect, it } from 'vitest';

import { filterProvidersByAllowlist, isModelAllowed } from './companyModelAllowlist';

describe('isModelAllowed', () => {
  it('allows all when unrestricted', () => {
    expect(isModelAllowed(null, 'openai', 'gpt-4o')).toBe(true);
    expect(isModelAllowed(undefined, 'openai', 'gpt-4o')).toBe(true);
  });

  it('blocks all when empty allowlist', () => {
    expect(isModelAllowed([], 'openai', 'gpt-4o')).toBe(false);
  });

  it('matches provider case-insensitively', () => {
    expect(isModelAllowed([{ model: 'gpt-4o', provider: 'OpenAI' }], 'openai', 'gpt-4o')).toBe(
      true,
    );
    expect(isModelAllowed([{ model: 'gpt-4o', provider: 'openai' }], 'openai', 'gpt-4o-mini')).toBe(
      false,
    );
  });
});

describe('filterProvidersByAllowlist', () => {
  const providers = [
    {
      children: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }],
      id: 'openai',
      name: 'OpenAI',
    },
    {
      children: [{ id: 'claude-sonnet' }],
      id: 'anthropic',
      name: 'Anthropic',
    },
  ];

  it('returns same list when unrestricted', () => {
    expect(filterProvidersByAllowlist(providers, null)).toBe(providers);
  });

  it('filters models and drops empty providers', () => {
    const filtered = filterProvidersByAllowlist(providers, [
      { model: 'gpt-4o', provider: 'openai' },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('openai');
    expect(filtered[0].children.map((c) => c.id)).toEqual(['gpt-4o']);
  });

  it('returns empty when allowlist is empty', () => {
    expect(filterProvidersByAllowlist(providers, [])).toEqual([]);
  });
});
