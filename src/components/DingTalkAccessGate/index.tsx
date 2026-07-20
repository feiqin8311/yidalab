'use client';

import { type CSSProperties, memo, type ReactNode, useEffect, useState } from 'react';

import {
  dingtalkSsoError,
  dingtalkSsoLog,
  dingtalkSsoWarn,
  fetchExistingAuthSession,
  initDingTalkSilentLogin,
} from '@/libs/dingtalk/clientAuth';
import {
  getAuthShellLeaveTarget,
  isBrowserAccessAllowed,
  isDingTalkClient,
  shouldBlockOutsideDingTalk,
} from '@/utils/dingtalkAccess';

type GateState =
  | { kind: 'checking' }
  | { kind: 'outside' }
  | { kind: 'logging-in' }
  | { kind: 'redirecting' }
  | { kind: 'login-failed'; message: string }
  | { kind: 'ready' };

const LOOP_KEY = 'yidalab:dingtalk-sso-attempts';
const LOOP_WINDOW_MS = 60_000;
const LOOP_MAX = 3;

/** Stop / ↔ /signin free-login thrash that ends as a blank root. */
const registerFreeLoginAttempt = (): { allowed: boolean; count: number } => {
  if (typeof window === 'undefined') return { allowed: true, count: 0 };
  try {
    const raw = sessionStorage.getItem(LOOP_KEY);
    const now = Date.now();
    const parsed = raw ? (JSON.parse(raw) as { count: number; startedAt: number }) : null;
    const state =
      parsed && now - parsed.startedAt < LOOP_WINDOW_MS ? parsed : { count: 0, startedAt: now };
    state.count += 1;
    sessionStorage.setItem(LOOP_KEY, JSON.stringify(state));
    return { allowed: state.count <= LOOP_MAX, count: state.count };
  } catch {
    return { allowed: true, count: 0 };
  }
};

const clearFreeLoginAttempts = () => {
  try {
    sessionStorage.removeItem(LOOP_KEY);
  } catch {
    // ignore
  }
};

/** Leave /signin (etc.) after free-login; stay put on the main SPA. */
const leaveAuthShell = (): 'navigating' | 'ready' => {
  if (typeof window === 'undefined') return 'ready';
  const target = getAuthShellLeaveTarget(window.location.pathname, window.location.search);
  if (target) {
    dingtalkSsoLog('leaving auth shell after session', {
      from: window.location.pathname + window.location.search,
      to: target,
    });
    // assign (not replace) so back-stack still works; either way breaks the loop
    // only after cookie is confirmed by the caller.
    window.location.assign(target);
    return 'navigating';
  }
  dingtalkSsoLog('session ready, staying on current route', {
    path: window.location.pathname,
  });
  return 'ready';
};

/**
 * Product gate for YidaLab:
 * - Browser: allow by default; account login is the real gate (middleware → /signin)
 * - Optional DingTalk-only: NEXT_PUBLIC_DINGTALK_ONLY=1 blocks non-DingTalk browsers
 * - Inside DingTalk: free-login (免登) when no session yet
 *
 * Mounted on both main SPA (entry.web/mobile) and auth SPA (entry.auth).
 * Middleware still redirects unauthenticated users to /signin — free-login must
 * therefore also run on the auth shell, then bounce back via callbackUrl.
 *
 * Important: never navigate away until /api/auth/get-session confirms the cookie,
 * otherwise middleware bounces back to /signin and free-login loops into a blank page.
 */
const DingTalkAccessGate = memo<{ children: ReactNode }>(({ children }) => {
  const [state, setState] = useState<GateState>(() => {
    if (shouldBlockOutsideDingTalk()) return { kind: 'outside' };
    // Dev browser: skip DingTalk SSO entirely
    if (!isDingTalkClient() && isBrowserAccessAllowed()) return { kind: 'ready' };
    return { kind: 'checking' };
  });

  useEffect(() => {
    if (
      state.kind === 'outside' ||
      state.kind === 'ready' ||
      state.kind === 'login-failed' ||
      state.kind === 'redirecting'
    ) {
      return;
    }

    let cancelled = false;

    const fail = (message: string) => {
      if (cancelled) return;
      // Inside DingTalk always surface the error. Silent skip in __DEV__ was why
      // "still asks for login" looked like free-login never ran.
      if (isDingTalkClient()) {
        dingtalkSsoError('free-login hard-failed', message);
        setState({ kind: 'login-failed', message });
        return;
      }
      if (isBrowserAccessAllowed()) {
        dingtalkSsoWarn('free-login skipped (browser-allow / dev)', message);
        setState({ kind: 'ready' });
        return;
      }
      dingtalkSsoError('free-login hard-failed', message);
      setState({ kind: 'login-failed', message });
    };

    const run = async () => {
      const inDingTalk = isDingTalkClient();
      const browserAllowed = isBrowserAccessAllowed();
      dingtalkSsoLog('gate bootstrap', {
        path:
          typeof window !== 'undefined' ? window.location.pathname + window.location.search : '',
        inDingTalk,
        browserAllowed,
        hasDd: typeof window !== 'undefined' && Boolean((window as any).dd),
      });

      // Browser override path already ready; only free-login inside DingTalk
      if (!inDingTalk) {
        dingtalkSsoLog('not in DingTalk client — skip free-login');
        if (!cancelled) setState({ kind: 'ready' });
        return;
      }

      try {
        const hasSession = await fetchExistingAuthSession();
        if (cancelled) return;
        if (hasSession) {
          clearFreeLoginAttempts();
          dingtalkSsoLog('gate: already signed in');
          if (leaveAuthShell() === 'navigating') {
            setState({ kind: 'redirecting' });
          } else {
            setState({ kind: 'ready' });
          }
          return;
        }

        const attempt = registerFreeLoginAttempt();
        dingtalkSsoLog('gate: free-login attempt', attempt);
        if (!attempt.allowed) {
          fail(
            `钉钉免登循环中断（${attempt.count} 次内未建立 session cookie）。请关闭后从工作台重开，或改用账号密码登录。`,
          );
          return;
        }

        dingtalkSsoLog('gate: starting free-login');
        setState({ kind: 'logging-in' });
        await initDingTalkSilentLogin();
        if (cancelled) return;

        // Cookie must be readable before we leave /signin — otherwise middleware
        // redirects back and we loop until the page goes blank.
        const confirmed = await fetchExistingAuthSession();
        if (cancelled) return;
        if (!confirmed) {
          fail(
            '钉钉登录接口已返回成功，但浏览器未拿到 session cookie（get-session 仍为空）。请检查域名/Cookie 设置。',
          );
          return;
        }

        clearFreeLoginAttempts();
        if (leaveAuthShell() === 'navigating') {
          setState({ kind: 'redirecting' });
        } else {
          setState({ kind: 'ready' });
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '钉钉免登失败';
        fail(message);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // only bootstrap once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.kind === 'outside') {
    return <div style={shellStyle}>请在钉钉客户端（工作台）内打开当前系统。</div>;
  }

  if (state.kind === 'checking' || state.kind === 'logging-in') {
    return <div style={shellStyle}>正在通过钉钉登录…</div>;
  }

  if (state.kind === 'redirecting') {
    return <div style={shellStyle}>登录成功，正在进入系统…</div>;
  }

  if (state.kind === 'login-failed') {
    return (
      <div style={shellStyle}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>钉钉免登失败</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.85, wordBreak: 'break-all' }}>
          {state.message}
        </div>
        <div style={{ fontSize: 12, marginTop: 16, opacity: 0.55 }}>
          控制台搜索 [DingTalkSSO] 可看分阶段日志
        </div>
        <button
          style={buttonStyle}
          type="button"
          onClick={() => {
            clearFreeLoginAttempts();
            setState({ kind: 'ready' });
          }}
        >
          改用账号密码登录
        </button>
      </div>
    );
  }

  return <>{children}</>;
});

const shellStyle: CSSProperties = {
  alignItems: 'center',
  // Hardcoded colors so dark-mode CSS vars never render as white-on-white / blank.
  background: '#f7f9fb',
  color: '#374151',
  display: 'flex',
  flexDirection: 'column',
  fontSize: 14,
  justifyContent: 'center',
  minHeight: '100vh',
  padding: 24,
  textAlign: 'center',
};

const buttonStyle: CSSProperties = {
  background: '#111827',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  marginTop: 20,
  padding: '10px 16px',
};

DingTalkAccessGate.displayName = 'DingTalkAccessGate';

export default DingTalkAccessGate;
