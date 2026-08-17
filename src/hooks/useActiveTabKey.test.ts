import { describe, expect, it } from 'vitest';

import { SidebarTabKey } from '@/store/global/initialState';

import { resolveActiveTabKey } from './useActiveTabKey';

describe('resolveActiveTabKey', () => {
  it('reads the first reserved product segment', () => {
    expect(resolveActiveTabKey('/community/home')).toBe(SidebarTabKey.Community);
    expect(resolveActiveTabKey('/resource')).toBe(SidebarTabKey.Resource);
  });

  it('skips a workspace slug prefix', () => {
    expect(resolveActiveTabKey('/acme/community/skill')).toBe(SidebarTabKey.Community);
    expect(resolveActiveTabKey('/acme/resource/library/1')).toBe(SidebarTabKey.Resource);
  });

  it('falls back to home when no product segment is present', () => {
    expect(resolveActiveTabKey('/')).toBe(SidebarTabKey.Home);
    expect(resolveActiveTabKey('/acme')).toBe(SidebarTabKey.Home);
  });
});
