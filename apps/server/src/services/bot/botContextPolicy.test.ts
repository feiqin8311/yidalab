import { DEFAULT_CONTEXT_BUDGETS, defaultInheritContextPolicy } from '@lobechat/agent-runtime';
import { describe, expect, it } from 'vitest';

import { botContextPolicy } from './botContextPolicy';

describe('botContextPolicy', () => {
  it('matches the Web agent runtime context policy', () => {
    expect(botContextPolicy).toEqual(defaultInheritContextPolicy());
    expect(botContextPolicy.budgets).toEqual(DEFAULT_CONTEXT_BUDGETS);
    expect(botContextPolicy.toolScope).toEqual({ discovery: true, mode: 'inherit' });
    expect(botContextPolicy.skillScope).toEqual({ mode: 'inherit' });
  });
});
