import { createHash, randomBytes } from 'node:crypto';

import { authEnv } from '@/envs/auth';

type TokenCache = { expiresAt: number; token: string };
type TicketCache = { expiresAt: number; ticket: string };

const tokenCache: TokenCache = { expiresAt: 0, token: '' };
const ticketCache: TicketCache = { expiresAt: 0, ticket: '' };

const TOKEN_URL = 'https://oapi.dingtalk.com/gettoken';
const JSAPI_TICKET_URL = 'https://oapi.dingtalk.com/get_jsapi_ticket';
const USERID_URL = 'https://oapi.dingtalk.com/topapi/v2/user/getuserinfo';
const USER_DETAIL_URL = 'https://oapi.dingtalk.com/topapi/v2/user/get';

export type DingTalkJsapiSign = {
  agentId?: string;
  corpId: string;
  nonceStr: string;
  signature: string;
  timeStamp: string;
};

export type DingTalkUserProfile = {
  avatar?: string;
  email?: string;
  mobile?: string;
  name?: string;
  unionid?: string;
  userid: string;
};

const getCredentials = () => {
  const appKey = authEnv.AUTH_DINGTALK_APP_KEY;
  const appSecret = authEnv.AUTH_DINGTALK_APP_SECRET;
  const corpId = authEnv.AUTH_DINGTALK_CORP_ID;
  if (!appKey || !appSecret || !corpId) {
    throw new Error('DingTalk auth is not configured (AUTH_DINGTALK_APP_KEY/SECRET/CORP_ID)');
  }
  return {
    agentId: authEnv.AUTH_DINGTALK_AGENT_ID,
    appKey,
    appSecret,
    corpId,
  };
};

export const isDingTalkAuthConfigured = () =>
  Boolean(
    authEnv.AUTH_DINGTALK_APP_KEY &&
    authEnv.AUTH_DINGTALK_APP_SECRET &&
    authEnv.AUTH_DINGTALK_CORP_ID,
  );

/** Public client bootstrap (no secrets) for free-login without JSAPI signature. */
export const getDingTalkBootstrapConfig = () => {
  const { agentId, corpId } = getCredentials();
  return {
    agentId: agentId || undefined,
    corpId,
  };
};

const ensureOk = (payload: any, context: string) => {
  const errcode = payload?.errcode ?? payload?.code;
  if (errcode !== undefined && errcode !== 0) {
    const errmsg = payload?.errmsg || payload?.message || 'unknown error';
    throw new Error(`DingTalk API error (${context}): ${errcode} ${errmsg}`);
  }
};

const httpGetJson = async (url: string, params: Record<string, string>) => {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  const response = await fetch(target, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`DingTalk HTTP GET failed (${response.status}): ${url}`);
  }
  return response.json();
};

const httpPostJson = async (url: string, body: Record<string, unknown>) => {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`DingTalk HTTP POST failed (${response.status}): ${url}`);
  }
  return response.json();
};

export const getDingTalkAccessToken = async (): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && now < tokenCache.expiresAt - 60) {
    return tokenCache.token;
  }

  const { appKey, appSecret } = getCredentials();
  const payload = await httpGetJson(TOKEN_URL, { appkey: appKey, appsecret: appSecret });
  ensureOk(payload, 'get_access_token');

  const token = String(payload.access_token || '');
  const expiresIn = Number(payload.expires_in || 7200);
  if (!token) throw new Error('DingTalk access_token missing');

  tokenCache.token = token;
  tokenCache.expiresAt = now + expiresIn;
  return token;
};

const getJsapiTicket = async (accessToken: string): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  if (ticketCache.ticket && now < ticketCache.expiresAt - 60) {
    return ticketCache.ticket;
  }

  const payload = await httpGetJson(JSAPI_TICKET_URL, { access_token: accessToken });
  ensureOk(payload, 'get_jsapi_ticket');

  const ticket = String(payload.ticket || '');
  const expiresIn = Number(payload.expires_in || 7200);
  if (!ticket) throw new Error('DingTalk jsapi ticket missing');

  ticketCache.ticket = ticket;
  ticketCache.expiresAt = now + expiresIn;
  return ticket;
};

export const signDingTalkJsapi = async (pageUrl: string): Promise<DingTalkJsapiSign> => {
  const { agentId, corpId } = getCredentials();
  const url = pageUrl.trim().split('#')[0];
  if (!url) throw new Error('Missing page url for JSAPI sign');

  const accessToken = await getDingTalkAccessToken();
  const ticket = await getJsapiTicket(accessToken);
  const nonceStr = randomBytes(9).toString('base64url');
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const raw = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timeStamp}&url=${url}`;
  const signature = createHash('sha1').update(raw).digest('hex');

  return {
    agentId: agentId || undefined,
    corpId,
    nonceStr,
    signature,
    timeStamp,
  };
};

export const getDingTalkUserByAuthCode = async (authCode: string): Promise<DingTalkUserProfile> => {
  const code = authCode.trim();
  if (!code) throw new Error('Missing DingTalk auth code');

  const accessToken = await getDingTalkAccessToken();
  const infoPayload = await httpPostJson(`${USERID_URL}?access_token=${accessToken}`, {
    code,
  });
  ensureOk(infoPayload, 'get_userid');

  const result = infoPayload.result || {};
  const userid = String(result.userid || '').trim();
  if (!userid) throw new Error('DingTalk userid missing');

  let detail: Record<string, any> = {};
  try {
    const detailPayload = await httpPostJson(`${USER_DETAIL_URL}?access_token=${accessToken}`, {
      userid,
    });
    ensureOk(detailPayload, 'get_user_detail');
    detail = detailPayload.result || {};
  } catch {
    // Detail is optional; login can proceed with userid only.
  }

  return {
    avatar: detail.avatar || result.avatar || undefined,
    email: detail.email || detail.org_email || undefined,
    mobile: detail.mobile || undefined,
    name: detail.name || result.name || userid,
    unionid: detail.unionid || result.unionid || undefined,
    userid,
  };
};
