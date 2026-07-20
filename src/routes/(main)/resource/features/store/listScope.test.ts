import { describe, expect, it } from 'vitest';

import { listVisibilityToListScope, listVisibilityToUploadVisibility } from './listScope';

describe('listVisibilityToListScope', () => {
  it('maps UI modes to API scopes', () => {
    expect(listVisibilityToListScope('private')).toBe('mine');
    expect(listVisibilityToListScope('shared')).toBe('shared_with_me');
    expect(listVisibilityToListScope('workspace')).toBe('workspace');
    expect(listVisibilityToListScope('admin_all')).toBe('admin_all');
  });
});

describe('listVisibilityToUploadVisibility', () => {
  it('only company tab uploads as public', () => {
    expect(listVisibilityToUploadVisibility('workspace')).toBe('public');
    expect(listVisibilityToUploadVisibility('private')).toBe('private');
    expect(listVisibilityToUploadVisibility('shared')).toBe('private');
    expect(listVisibilityToUploadVisibility('admin_all')).toBe('private');
  });
});
