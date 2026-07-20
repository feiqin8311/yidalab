import { describe, expect, it } from 'vitest';

/**
 * Pure resolution helper mirrored from dingtalk plugin behavior.
 * Keeps the username/email/account priority documented and regression-tested.
 */
const resolveMatchSource = (input: {
  hasAccount: boolean;
  profileEmail?: string;
  emailUserExists: boolean;
  displayName: string;
  usernameUserExists: boolean;
}): 'account' | 'email' | 'username' | 'create' => {
  if (input.hasAccount) return 'account';
  if (input.profileEmail && input.emailUserExists) return 'email';
  if (input.displayName && input.usernameUserExists) return 'username';
  return 'create';
};

describe('dingtalk user resolve order', () => {
  it('prefers existing dingtalk account', () => {
    expect(
      resolveMatchSource({
        displayName: '柯鹏翔',
        emailUserExists: true,
        hasAccount: true,
        profileEmail: 'kerden8421@gmail.com',
        usernameUserExists: true,
      }),
    ).toBe('account');
  });

  it('matches pre-seeded staff by username when email is synthetic', () => {
    // DingTalk often omits personal email → syntheticEmail won't match kerden8421@gmail.com
    expect(
      resolveMatchSource({
        displayName: '柯鹏翔',
        emailUserExists: false,
        hasAccount: false,
        profileEmail: undefined,
        usernameUserExists: true,
      }),
    ).toBe('username');
  });

  it('matches by real profile email when present', () => {
    expect(
      resolveMatchSource({
        displayName: '柯鹏翔',
        emailUserExists: true,
        hasAccount: false,
        profileEmail: 'kerden8421@gmail.com',
        usernameUserExists: false,
      }),
    ).toBe('email');
  });

  it('falls back to create for unknown DingTalk users', () => {
    expect(
      resolveMatchSource({
        displayName: '新人',
        emailUserExists: false,
        hasAccount: false,
        profileEmail: undefined,
        usernameUserExists: false,
      }),
    ).toBe('create');
  });
});
