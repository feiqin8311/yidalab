import { t } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type UserStore } from '@/store/user';

import { authSelectors, userProfileSelectors } from './selectors';

vi.mock('i18next', () => ({
  t: vi.fn((key) => key),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('userProfileSelectors', () => {
  describe('displayUserName', () => {
    it('should return user username when signed in', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { username: 'johndoe' },
      } as UserStore;

      expect(userProfileSelectors.displayUserName(store)).toBe('johndoe');
    });

    it('should prefer username over username', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { username: 'johndoe' },
      } as UserStore;

      expect(userProfileSelectors.displayUserName(store)).toBe('johndoe');
    });

    it('should return email when signed in but username is not existed in UserStore', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { email: 'demo@lobehub.com' },
      } as UserStore;

      expect(userProfileSelectors.displayUserName(store)).toBe('demo@lobehub.com');
    });

    it('should return "anonymous" when not signed in', () => {
      const store: UserStore = {
        isSignedIn: false,
        user: null,
      } as unknown as UserStore;

      expect(userProfileSelectors.displayUserName(store)).toBe('anonymous');
    });
  });

  describe('email', () => {
    it('should return user email if exist', () => {
      const store: UserStore = {
        user: { email: 'demo@lobehub.com' },
      } as UserStore;

      expect(userProfileSelectors.email(store)).toBe('demo@lobehub.com');
    });

    it('should return empty string if not exist', () => {
      const store: UserStore = {
        user: { email: undefined },
      } as UserStore;

      expect(userProfileSelectors.email(store)).toBe('');
    });
  });

  describe('username', () => {
    it('should return user username if exist', () => {
      const store: UserStore = {
        user: { username: 'John Doe' },
      } as UserStore;

      expect(userProfileSelectors.username(store)).toBe('John Doe');
    });

    it('should return empty string if not exist', () => {
      const store: UserStore = {
        user: { username: undefined },
      } as UserStore;

      expect(userProfileSelectors.username(store)).toBe('');
    });
  });

  describe('nickName', () => {
    it('should prefer username when signed in', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { username: 'johndoe' },
      } as UserStore;

      expect(userProfileSelectors.nickName(store)).toBe('johndoe');
    });

    it('should return user username when username is not available', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { username: 'John Doe' },
      } as UserStore;

      expect(userProfileSelectors.nickName(store)).toBe('John Doe');
    });

    it('should return anonymous nickname when not signed in', () => {
      const store: UserStore = {
        isSignedIn: false,
        user: null,
      } as unknown as UserStore;

      expect(userProfileSelectors.nickName(store)).toBe('userPanel.anonymousNickName');
      expect(t).toHaveBeenCalledWith('userPanel.anonymousNickName', { ns: 'common' });
    });
  });

  describe('username', () => {
    it('should return user username when signed in', () => {
      const store: UserStore = {
        isSignedIn: true,
        user: { username: 'johndoe' },
      } as UserStore;

      expect(userProfileSelectors.username(store)).toBe('johndoe');
    });

    it('should return "anonymous" when not signed in', () => {
      const store: UserStore = {
        isSignedIn: false,
        user: null,
      } as unknown as UserStore;

      expect(userProfileSelectors.username(store)).toBe('anonymous');
    });
  });
});

describe('authSelectors', () => {
  describe('isLogin', () => {
    it('should return true when signed in', () => {
      const store: UserStore = {
        isSignedIn: true,
      } as UserStore;

      expect(authSelectors.isLogin(store)).toBe(true);
    });

    it('should return false when not signed in', () => {
      const store: UserStore = {
        isSignedIn: false,
      } as UserStore;

      expect(authSelectors.isLogin(store)).toBe(false);
    });
  });
});
