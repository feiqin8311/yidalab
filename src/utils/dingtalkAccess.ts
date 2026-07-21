/**
 * YidaLab access helpers.
 *
 * Default product model:
 * - Browser: normal login (password etc.) — not blocked
 * - DingTalk: free-login (免登) when possible
 *
 * Opt-in DingTalk-only mode (block non-DingTalk browsers):
 *   NEXT_PUBLIC_DINGTALK_ONLY=1
 */

import { sanitizeRedirectPath } from '@/utils/onboardingRedirect';

/** Auth SPA routes served by entry.auth — free-login must leave these after session. */
const AUTH_SHELL_PREFIXES = [
  '/signin',
  '/signup',
  '/verify-email',
  '/reset-password',
  '/auth-error',
] as const;

export const isDingTalkClient = (): boolean => {
  if (typeof window === 'undefined') return false;
  const ua = String(window.navigator?.userAgent || '').toLowerCase();
  // DingTalk injects `window.dd` (JSAPI) and usually has "DingTalk" in the UA.
  return Boolean((window as any).dd) || ua.includes('dingtalk');
};

/**
 * Whether a non-DingTalk browser may boot the SPA.
 *
 * Always true for dev and Electron. Production allows browsers by default
 * (account login is the gate). Set `NEXT_PUBLIC_DINGTALK_ONLY=1` to refuse
 * browsers outside DingTalk.
 *
 * Legacy: `NEXT_PUBLIC_ALLOW_BROWSER_ACCESS=0` also enables DingTalk-only mode.
 */
export const isBrowserAccessAllowed = (): boolean => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  if (typeof __ELECTRON__ !== 'undefined' && __ELECTRON__) return true;
  if (process.env.NEXT_PUBLIC_DINGTALK_ONLY === '1') return false;
  // Legacy inverse of the old allow-flag (was required to open browsers in prod).
  if (process.env.NEXT_PUBLIC_ALLOW_BROWSER_ACCESS === '0') return false;
  return true;
};

/** True when the SPA should refuse to boot outside DingTalk. */
export const shouldBlockOutsideDingTalk = (): boolean => {
  if (isBrowserAccessAllowed()) return false;
  return !isDingTalkClient();
};

export const isAuthShellPath = (pathname: string): boolean =>
  AUTH_SHELL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * After DingTalk free-login (or when a session already exists on /signin),
 * leave the auth shell. Returns null when the current page should stay put.
 */
export const getAuthShellLeaveTarget = (pathname: string, search: string): string | null => {
  if (!isAuthShellPath(pathname)) return null;

  const callbackUrl = new URLSearchParams(search).get('callbackUrl');
  // Prefer same-origin relative path. Cross-host callbackUrl (localhost vs LAN
  // IP) is treated as unsafe by sanitizeRedirectPath and falls back to `/`,
  // which is correct — stay on the host DingTalk actually opened.
  const target = sanitizeRedirectPath(callbackUrl, '/');
  const targetPath = target.split(/[?#]/)[0] || '/';

  // Avoid bouncing back onto the auth shell (e.g. callbackUrl=/signin).
  if (isAuthShellPath(targetPath)) return '/';
  return target;
};
