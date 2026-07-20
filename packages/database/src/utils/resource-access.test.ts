import { describe, expect, it } from 'vitest';

import { resolveListScope } from './resource-access';

describe('resolveListScope', () => {
  it('prefers listScope over legacy visibility', () => {
    expect(resolveListScope('shared_with_me', 'public')).toBe('shared_with_me');
  });

  it('maps private visibility to mine', () => {
    expect(resolveListScope(undefined, 'private')).toBe('mine');
  });

  it('maps public visibility to workspace', () => {
    expect(resolveListScope(undefined, 'public')).toBe('workspace');
  });

  it('returns undefined when neither is set', () => {
    expect(resolveListScope(undefined, undefined)).toBeUndefined();
  });
});
