import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getAuthShellLeaveTarget,
  isAuthShellPath,
  isBrowserAccessAllowed,
  isDingTalkClient,
  shouldBlockOutsideDingTalk,
} from './dingtalkAccess';

describe('dingtalkAccess', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    // restore defaults used by sharedRendererDefine in tests
    vi.stubGlobal('__DEV__', false);
    vi.stubGlobal('__ELECTRON__', false);
  });

  describe('isDingTalkClient', () => {
    it('returns true when window.dd exists', () => {
      vi.stubGlobal('window', {
        dd: {},
        navigator: { userAgent: 'Mozilla/5.0' },
      });
      expect(isDingTalkClient()).toBe(true);
    });

    it('returns true when UA contains dingtalk', () => {
      vi.stubGlobal('window', {
        navigator: { userAgent: 'Mozilla/5.0 (iPhone; DingTalk/7.0)' },
      });
      expect(isDingTalkClient()).toBe(true);
    });

    it('returns false in a normal browser', () => {
      vi.stubGlobal('window', {
        navigator: { userAgent: 'Mozilla/5.0 Chrome/120.0.0.0' },
      });
      expect(isDingTalkClient()).toBe(false);
    });
  });

  describe('isBrowserAccessAllowed', () => {
    it('allows browser when __DEV__ is true', () => {
      vi.stubGlobal('__DEV__', true);
      vi.stubGlobal('__ELECTRON__', false);
      vi.stubEnv('NEXT_PUBLIC_DINGTALK_ONLY', '1');
      expect(isBrowserAccessAllowed()).toBe(true);
    });

    it('allows browser by default in production', () => {
      vi.stubGlobal('__DEV__', false);
      vi.stubGlobal('__ELECTRON__', false);
      vi.stubEnv('NEXT_PUBLIC_DINGTALK_ONLY', '');
      vi.stubEnv('NEXT_PUBLIC_ALLOW_BROWSER_ACCESS', '');
      expect(isBrowserAccessAllowed()).toBe(true);
    });

    it('allows Electron shell even when DingTalk-only is set', () => {
      vi.stubGlobal('__DEV__', false);
      vi.stubGlobal('__ELECTRON__', true);
      vi.stubEnv('NEXT_PUBLIC_DINGTALK_ONLY', '1');
      expect(isBrowserAccessAllowed()).toBe(true);
    });

    it('denies browser when NEXT_PUBLIC_DINGTALK_ONLY=1', () => {
      vi.stubGlobal('__DEV__', false);
      vi.stubGlobal('__ELECTRON__', false);
      vi.stubEnv('NEXT_PUBLIC_DINGTALK_ONLY', '1');
      expect(isBrowserAccessAllowed()).toBe(false);
    });

    it('denies browser with legacy NEXT_PUBLIC_ALLOW_BROWSER_ACCESS=0', () => {
      vi.stubGlobal('__DEV__', false);
      vi.stubGlobal('__ELECTRON__', false);
      vi.stubEnv('NEXT_PUBLIC_DINGTALK_ONLY', '');
      vi.stubEnv('NEXT_PUBLIC_ALLOW_BROWSER_ACCESS', '0');
      expect(isBrowserAccessAllowed()).toBe(false);
    });
  });

  describe('shouldBlockOutsideDingTalk', () => {
    it('does not block in dev even outside DingTalk', () => {
      vi.stubGlobal('__DEV__', true);
      vi.stubGlobal('window', {
        navigator: { userAgent: 'Mozilla/5.0 Chrome/120.0.0.0' },
      });
      expect(shouldBlockOutsideDingTalk()).toBe(false);
    });

    it('does not block production browser by default', () => {
      vi.stubGlobal('__DEV__', false);
      vi.stubGlobal('__ELECTRON__', false);
      vi.stubEnv('NEXT_PUBLIC_DINGTALK_ONLY', '');
      vi.stubEnv('NEXT_PUBLIC_ALLOW_BROWSER_ACCESS', '');
      vi.stubGlobal('window', {
        navigator: { userAgent: 'Mozilla/5.0 Chrome/120.0.0.0' },
      });
      expect(shouldBlockOutsideDingTalk()).toBe(false);
    });

    it('blocks production browser when DingTalk-only is on', () => {
      vi.stubGlobal('__DEV__', false);
      vi.stubGlobal('__ELECTRON__', false);
      vi.stubEnv('NEXT_PUBLIC_DINGTALK_ONLY', '1');
      vi.stubGlobal('window', {
        navigator: { userAgent: 'Mozilla/5.0 Chrome/120.0.0.0' },
      });
      expect(shouldBlockOutsideDingTalk()).toBe(true);
    });

    it('does not block DingTalk client in DingTalk-only mode', () => {
      vi.stubGlobal('__DEV__', false);
      vi.stubGlobal('__ELECTRON__', false);
      vi.stubEnv('NEXT_PUBLIC_DINGTALK_ONLY', '1');
      vi.stubGlobal('window', {
        dd: {},
        navigator: { userAgent: 'DingTalk' },
      });
      expect(shouldBlockOutsideDingTalk()).toBe(false);
    });
  });

  describe('isAuthShellPath', () => {
    it('matches signin and nested auth paths', () => {
      expect(isAuthShellPath('/signin')).toBe(true);
      expect(isAuthShellPath('/signup')).toBe(true);
      expect(isAuthShellPath('/')).toBe(false);
      expect(isAuthShellPath('/agent/foo')).toBe(false);
    });
  });

  describe('getAuthShellLeaveTarget', () => {
    it('returns null on main SPA routes', () => {
      expect(getAuthShellLeaveTarget('/', '')).toBeNull();
      expect(getAuthShellLeaveTarget('/agent/x', '')).toBeNull();
    });

    it('returns callbackUrl when safe', () => {
      expect(getAuthShellLeaveTarget('/signin', '?callbackUrl=%2Fhome')).toBe('/home');
    });

    it('falls back to / when callback is missing or hostile', () => {
      expect(getAuthShellLeaveTarget('/signin', '')).toBe('/');
      expect(getAuthShellLeaveTarget('/signin', '?callbackUrl=https%3A%2F%2Fevil.com')).toBe('/');
    });

    it('falls back to / when callback points back at the auth shell', () => {
      expect(getAuthShellLeaveTarget('/signin', '?callbackUrl=%2Fsignin')).toBe('/');
    });
  });
});
