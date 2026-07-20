import { describe, expect, it } from 'vitest';

import { canAccessWithoutCompany } from './WorkspaceContextSlot';

describe('canAccessWithoutCompany', () => {
  it('only allows personal settings and company invitations before joining a company', () => {
    expect(canAccessWithoutCompany('/settings')).toBe(true);
    expect(canAccessWithoutCompany('/settings/profile')).toBe(true);
    expect(canAccessWithoutCompany('/company/invite/token-1')).toBe(true);

    expect(canAccessWithoutCompany('/')).toBe(false);
    expect(canAccessWithoutCompany('/agent/inbox')).toBe(false);
    expect(canAccessWithoutCompany('/page')).toBe(false);
  });
});
