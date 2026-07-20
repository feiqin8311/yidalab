/**
 * Client-side DingTalk JSAPI free-login helpers.
 * Server endpoints: /api/auth/dingtalk/bootstrap, /jsapi-sign, /login
 *
 * Logs use a fixed `[DingTalkSSO]` prefix so they show in the DingTalk webview
 * console without needing localStorage.debug.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const JSAPI_CDN = 'https://g.alicdn.com/dingding/dingtalk-jsapi/2.13.42/dingtalk.open.js';
const LOG_PREFIX = '[DingTalkSSO]';

type DingTalkBootstrap = {
  agentId?: string;
  corpId: string;
};

type DingTalkJsapiSign = DingTalkBootstrap & {
  nonceStr: string;
  signature: string;
  timeStamp: string;
};

type DingTalkLoginResult = {
  session?: { token?: string; userId?: string };
  user?: { email?: string; id?: string; image?: string | null; name?: string | null };
};

export const dingtalkSsoLog = (stage: string, detail?: unknown) => {
  if (detail === undefined) {
    console.info(`${LOG_PREFIX} ${stage}`);
    return;
  }
  console.info(`${LOG_PREFIX} ${stage}`, detail);
};

export const dingtalkSsoWarn = (stage: string, detail?: unknown) => {
  if (detail === undefined) {
    console.warn(`${LOG_PREFIX} ${stage}`);
    return;
  }
  console.warn(`${LOG_PREFIX} ${stage}`, detail);
};

export const dingtalkSsoError = (stage: string, detail?: unknown) => {
  if (detail === undefined) {
    console.error(`${LOG_PREFIX} ${stage}`);
    return;
  }
  console.error(`${LOG_PREFIX} ${stage}`, detail);
};

/** DingTalk onFail often returns a plain object, not Error. */
export const formatDingTalkError = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const msg =
      e.errorMessage || e.errorMsg || e.message || e.msg || e.errorCode || e.code || e.error;
    if (typeof msg === 'string' || typeof msg === 'number') {
      return String(msg);
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  stage: string,
): Promise<T> => {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          reject(new Error(`${stage} timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
};

export const loadDingTalkJsApi = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  if ((window as any).dd) {
    dingtalkSsoLog('jsapi already present (window.dd)');
    return true;
  }

  dingtalkSsoLog('loading jsapi script', { src: JSAPI_CDN });

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-dingtalk-jsapi]');
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean((window as any).dd)));
      existing.addEventListener('error', () => resolve(false));
      if ((window as any).dd) resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = JSAPI_CDN;
    script.async = true;
    script.dataset.dingtalkJsapi = '1';
    script.onload = () => {
      const ok = Boolean((window as any).dd);
      dingtalkSsoLog(ok ? 'jsapi script loaded' : 'jsapi script loaded but window.dd missing');
      resolve(ok);
    };
    script.onerror = () => {
      dingtalkSsoError('jsapi script failed to load (CDN/network)');
      resolve(false);
    };
    document.head.appendChild(script);
  });
};

const waitDdReady = () =>
  new Promise<void>((resolve, reject) => {
    const dd = (window as any).dd;
    if (!dd) {
      reject(new Error('DingTalk JSAPI not available'));
      return;
    }
    // Already in ready state on some clients
    if (typeof dd.ready !== 'function') {
      resolve();
      return;
    }
    let settled = false;
    dd.ready(() => {
      if (settled) return;
      settled = true;
      resolve();
    });
    if (typeof dd.error === 'function') {
      dd.error((err: unknown) => {
        if (settled) return;
        settled = true;
        reject(new Error(`dd.error: ${formatDingTalkError(err)}`));
      });
    }
  });

const ddConfigReady = (config: DingTalkJsapiSign) =>
  new Promise<void>((resolve, reject) => {
    const dd = (window as any).dd;
    if (!dd?.config) {
      reject(new Error('DingTalk JSAPI config not available'));
      return;
    }
    let settled = false;
    dd.config({
      agentId: config.agentId ? Number(config.agentId) : undefined,
      corpId: config.corpId,
      jsApiList: ['runtime.permission.requestAuthCode'],
      nonceStr: config.nonceStr,
      signature: config.signature,
      timeStamp: config.timeStamp,
    });
    dd.ready(() => {
      if (settled) return;
      settled = true;
      resolve();
    });
    dd.error((err: unknown) => {
      if (settled) return;
      settled = true;
      reject(new Error(`dd.config error: ${formatDingTalkError(err)}`));
    });
  });

const requestAuthCode = (corpId: string) =>
  new Promise<string>((resolve, reject) => {
    const dd = (window as any).dd;
    if (!dd?.runtime?.permission?.requestAuthCode) {
      reject(new Error('dd.runtime.permission.requestAuthCode missing'));
      return;
    }
    dd.runtime.permission.requestAuthCode({
      corpId,
      onFail: (err: unknown) => reject(new Error(formatDingTalkError(err))),
      onSuccess: (res: { authCode?: string; code?: string }) => {
        const code = res?.code || res?.authCode;
        if (!code) reject(new Error(`Missing auth code in response: ${JSON.stringify(res)}`));
        else resolve(code);
      },
    });
  });

const fetchBootstrap = async (timeoutMs: number): Promise<DingTalkBootstrap> => {
  const res = await withTimeout(
    fetch('/api/auth/dingtalk/bootstrap', { credentials: 'include' }),
    timeoutMs,
    'dingtalk bootstrap',
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`bootstrap failed: HTTP ${res.status} ${text}`);
  }
  const data = (await res.json()) as DingTalkBootstrap;
  if (!data?.corpId) throw new Error('bootstrap missing corpId');
  return data;
};

const fetchJsapiSign = async (pageUrl: string, timeoutMs: number): Promise<DingTalkJsapiSign> => {
  const res = await withTimeout(
    fetch('/api/auth/dingtalk/jsapi-sign', {
      body: JSON.stringify({ url: pageUrl }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
    timeoutMs,
    'dingtalk jsapi-sign',
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`JSAPI sign failed: HTTP ${res.status} ${text}`);
  }
  const sign = (await res.json()) as DingTalkJsapiSign;
  if (!sign?.corpId) throw new Error('Missing corpId in sign response');
  return sign;
};

const postLogin = async (authCode: string, timeoutMs: number): Promise<DingTalkLoginResult> => {
  dingtalkSsoLog('POST /api/auth/dingtalk/login …');
  const loginRes = await withTimeout(
    fetch('/api/auth/dingtalk/login', {
      body: JSON.stringify({ authCode }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
    timeoutMs,
    'dingtalk login',
  );
  if (!loginRes.ok) {
    const text = await loginRes.text().catch(() => '');
    dingtalkSsoError('login failed', { status: loginRes.status, body: text.slice(0, 300) });
    throw new Error(`DingTalk login failed: HTTP ${loginRes.status} ${text}`);
  }
  return (await loginRes.json()) as DingTalkLoginResult;
};

/**
 * Obtain auth code:
 * 1) Prefer free-login without dd.config (official free-login only needs ready + requestAuthCode)
 * 2) Fall back to full JSAPI signature + dd.config when (1) fails
 */
const obtainAuthCode = async (timeoutMs: number): Promise<string> => {
  const pageUrl = window.location.href.split('#')[0];
  const errors: string[] = [];

  // Path A — no config (most reliable for pure free-login)
  try {
    const boot = await fetchBootstrap(timeoutMs);
    dingtalkSsoLog('bootstrap ok', { corpId: boot.corpId, agentId: boot.agentId });
    dingtalkSsoLog('path A: dd.ready without config …');
    await withTimeout(waitDdReady(), timeoutMs, 'dingtalk ready (no config)');
    dingtalkSsoLog('path A: requestAuthCode …', { corpId: boot.corpId });
    const code = await withTimeout(requestAuthCode(boot.corpId), timeoutMs, 'auth-code A');
    dingtalkSsoLog('path A auth-code ok', { codeLen: code.length });
    return code;
  } catch (error) {
    const msg = formatDingTalkError(error);
    errors.push(`A(no-config): ${msg}`);
    dingtalkSsoWarn('path A failed, trying path B (jsapi-sign + config)', msg);
  }

  // Path B — full jsapi auth (needed when container requires signed config)
  try {
    dingtalkSsoLog('path B: jsapi-sign', { pageUrl });
    const sign = await fetchJsapiSign(pageUrl, timeoutMs);
    dingtalkSsoLog('path B: jsapi-sign ok', {
      corpId: sign.corpId,
      agentId: sign.agentId,
      signatureLen: sign.signature?.length ?? 0,
    });
    dingtalkSsoLog('path B: dd.config …');
    await withTimeout(ddConfigReady(sign), timeoutMs, 'dingtalk config');
    dingtalkSsoLog('path B: dd.config ready');
    const code = await withTimeout(requestAuthCode(sign.corpId), timeoutMs, 'auth-code B');
    dingtalkSsoLog('path B auth-code ok', { codeLen: code.length });
    return code;
  } catch (error) {
    const msg = formatDingTalkError(error);
    errors.push(`B(config): ${msg}`);
    dingtalkSsoError('path B failed', msg);
  }

  throw new Error(
    `无法获取钉钉免登 authCode。${errors.join(' | ')}。请确认：1) 在钉钉工作台内打开 2) 应用首页/安全域名包含当前域名 ${window.location.origin}`,
  );
};

/**
 * Run DingTalk free-login and establish a better-auth session cookie.
 * Throws when JSAPI is unavailable or any stage fails (caller decides soft/hard fail).
 */
export const initDingTalkSilentLogin = async (
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DingTalkLoginResult> => {
  if (typeof window === 'undefined') {
    throw new Error('DingTalk free-login requires a browser window');
  }

  dingtalkSsoLog('free-login start', {
    href: window.location.href.split('#')[0],
    origin: window.location.origin,
    hasDd: Boolean((window as any).dd),
    ua: String(window.navigator?.userAgent || '').slice(0, 160),
  });

  const loaded = await loadDingTalkJsApi();
  if (!loaded || !(window as any).dd) {
    throw new Error('DingTalk JSAPI unavailable (window.dd missing after load)');
  }

  const authCode = await obtainAuthCode(timeoutMs);
  const result = await postLogin(authCode, timeoutMs);

  dingtalkSsoLog('free-login success', {
    userId: result.user?.id,
    name: result.user?.name,
    sessionUserId: result.session?.userId,
  });
  return result;
};

export const fetchExistingAuthSession = async (): Promise<boolean> => {
  try {
    const res = await fetch('/api/auth/get-session', { credentials: 'include' });
    if (!res.ok) {
      dingtalkSsoLog('get-session not ok', { status: res.status });
      return false;
    }
    const data = await res.json();
    const hasSession = Boolean(data?.session || data?.user);
    dingtalkSsoLog(hasSession ? 'existing session found' : 'no existing session', {
      hasUser: Boolean(data?.user),
      hasSession: Boolean(data?.session),
    });
    return hasSession;
  } catch (error) {
    dingtalkSsoWarn('get-session request failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};
