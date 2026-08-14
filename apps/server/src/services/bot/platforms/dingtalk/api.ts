import { pickTrimmedString, toRecord } from '@lobechat/utils/object';
import debug from 'debug';

import { DINGTALK_REQUEST_TIMEOUT_MS } from './const';

const log = debug('bot-platform:dingtalk:api');

const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
const EMOTION_BASE = 'https://api.dingtalk.com/v1.0/robot/emotion';
const MESSAGE_FILE_DOWNLOAD = 'https://api.dingtalk.com/v1.0/robot/messageFiles/download';
const GROUP_MESSAGE_SEND = 'https://api.dingtalk.com/v1.0/robot/groupMessages/send';
const OTO_MESSAGE_BATCH_SEND = 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend';
const TOKEN_FETCH_MAX_ATTEMPTS = 3;
const TOKEN_FETCH_RETRY_BASE_DELAY_MS = 100;

/** Align with workbook parse hard cap — refuse larger robot downloads. */
export const DINGTALK_MAX_ROBOT_FILE_BYTES = 20 * 1024 * 1024;

/** Native "thinking" text-emotion used by DingTalk robot emotion API. */
const ACK_EMOTION = {
  backgroundId: 'im_bg_1',
  emotionId: '2659900',
  emotionName: '🤔思考中',
} as const;

const tokenCache = new Map<string, { expiresAt: number; token: string }>();

const sleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

const getDingTalkErrorCode = (result: unknown): string | undefined => {
  const payload = toRecord(result);
  if (!payload) return undefined;

  const rawCode = payload.errcode ?? payload.code ?? payload.subCode;
  if (typeof rawCode === 'number' && Number.isFinite(rawCode)) return String(rawCode);
  return pickTrimmedString(rawCode);
};

/** DingTalk may report delivery failure in a successful HTTP response. */
export const ensureDingTalkBusinessSuccess = (result: unknown, operation: string): void => {
  const payload = toRecord(result);
  if (!payload) return;

  const code = getDingTalkErrorCode(payload);
  const failedByFlag = payload.success === false || payload.result === false;
  const failedByCode = code !== undefined && code !== '0';
  if (!failedByFlag && !failedByCode) return;

  const message =
    pickTrimmedString(payload.message) ??
    pickTrimmedString(payload.errmsg) ??
    pickTrimmedString(payload.msg) ??
    pickTrimmedString(payload.errorMessage);
  const detail = [code && code !== '0' ? `code=${code}` : undefined, message]
    .filter(Boolean)
    .join(' ');
  throw new Error(`DingTalk ${operation} failed${detail ? `: ${detail}` : ''}`);
};

const shouldRetryTokenFetch = (status: number): boolean => status === 429 || status >= 500;

export async function getDingTalkAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cached = tokenCache.get(clientId);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  for (let attempt = 1; attempt <= TOKEN_FETCH_MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(TOKEN_URL, {
        body: JSON.stringify({ appKey: clientId, appSecret: clientSecret }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(DINGTALK_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt === TOKEN_FETCH_MAX_ATTEMPTS) throw error;
      const delayMs = TOKEN_FETCH_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      log('accessToken network failure; retrying attempt=%d delayMs=%d', attempt, delayMs);
      await sleep(delayMs);
      continue;
    }

    if (!response.ok) {
      if (attempt < TOKEN_FETCH_MAX_ATTEMPTS && shouldRetryTokenFetch(response.status)) {
        const delayMs = TOKEN_FETCH_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        log(
          'accessToken transient HTTP failure; retrying status=%d attempt=%d delayMs=%d',
          response.status,
          attempt,
          delayMs,
        );
        await sleep(delayMs);
        continue;
      }
      throw new Error(`DingTalk accessToken failed: HTTP ${response.status}`);
    }

    const result = (await response.json()) as {
      accessToken?: string;
      access_token?: string;
      expireIn?: number;
      expires_in?: number;
    };
    const token = result.accessToken || result.access_token;
    if (!token) throw new Error('DingTalk accessToken missing in response');

    const expiresIn = Number(result.expireIn || result.expires_in || 7200);
    tokenCache.set(clientId, { expiresAt: Date.now() + expiresIn * 1000, token });
    return token;
  }

  throw new Error('DingTalk accessToken retry exhausted');
}

/**
 * Send a Markdown message without relying on the short-lived sessionWebhook.
 * Group conversations address the open conversation directly; DMs require the
 * sender's enterprise staff userId captured from an earlier inbound message.
 */
export async function sendDingTalkRobotMarkdown(params: {
  clientId: string;
  clientSecret: string;
  conversationId: string;
  conversationType: string;
  text: string;
  title: string;
  userId?: string;
}): Promise<unknown> {
  const { clientId, clientSecret, conversationId, conversationType, text, title, userId } = params;
  const isGroup = conversationType === '2';
  const targetUserId = userId?.trim();
  if (!isGroup && !targetUserId) {
    throw new Error('DingTalk proactive DM requires senderStaffId or senderId');
  }

  const token = await getDingTalkAccessToken(clientId, clientSecret);
  const message = {
    msgKey: 'sampleMarkdown',
    msgParam: JSON.stringify({ text, title }),
    robotCode: clientId,
  };
  const response = await fetch(isGroup ? GROUP_MESSAGE_SEND : OTO_MESSAGE_BATCH_SEND, {
    body: JSON.stringify(
      isGroup
        ? { ...message, openConversationId: conversationId }
        : { ...message, userIds: [targetUserId!] },
    ),
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': token,
    },
    method: 'POST',
    signal: AbortSignal.timeout(DINGTALK_REQUEST_TIMEOUT_MS),
  });
  const detail = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(
      `DingTalk proactive ${isGroup ? 'group' : 'DM'} send failed: HTTP ${response.status} ${detail.slice(0, 300)}`.trim(),
    );
  }

  let result: Record<string, unknown> = {};
  if (detail) {
    try {
      result = JSON.parse(detail) as Record<string, unknown>;
    } catch {
      throw new Error('DingTalk proactive send returned non-JSON response');
    }
  }
  ensureDingTalkBusinessSuccess(result, `proactive ${isGroup ? 'group' : 'DM'} send`);
  if (!isGroup) {
    const invalid = Array.isArray(result.invalidStaffIdList) ? result.invalidStaffIdList : [];
    const throttled = Array.isArray(result.flowControlledStaffIdList)
      ? result.flowControlledStaffIdList
      : [];
    if (invalid.length > 0 || throttled.length > 0) {
      throw new Error(
        `DingTalk proactive DM was not accepted (invalid=${invalid.length}, throttled=${throttled.length})`,
      );
    }
  }
  return result;
}

/**
 * Native emotion under an inbound robot message (reply / recall).
 * @see https://open.dingtalk.com/document/orgapp/add-robot-response-emoticons
 */
export async function dingTalkMessageEmotion(params: {
  clientId: string;
  clientSecret: string;
  conversationId: string;
  emotionName?: string;
  msgId: string;
  recall?: boolean;
}): Promise<void> {
  const {
    clientId,
    clientSecret,
    conversationId,
    emotionName = ACK_EMOTION.emotionName,
    msgId,
    recall = false,
  } = params;
  if (!clientId || !clientSecret || !msgId || !conversationId) {
    log(
      'skip emotion: missing fields clientId=%s msgId=%s cid=%s',
      !!clientId,
      !!msgId,
      !!conversationId,
    );
    return;
  }

  const token = await getDingTalkAccessToken(clientId, clientSecret);
  const action = recall ? 'recall' : 'reply';
  const response = await fetch(`${EMOTION_BASE}/${action}`, {
    body: JSON.stringify({
      emotionName,
      emotionType: 2,
      openConversationId: conversationId,
      openMsgId: msgId,
      robotCode: clientId,
      textEmotion: {
        backgroundId: ACK_EMOTION.backgroundId,
        emotionId: ACK_EMOTION.emotionId,
        emotionName,
        text: emotionName,
      },
    }),
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': token,
    },
    method: 'POST',
    signal: AbortSignal.timeout(DINGTALK_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`DingTalk emotion ${action} failed: HTTP ${response.status} ${detail}`);
  }
}

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;

/** Stream response body with a hard byte cap (cancel reader when exceeded). */
export async function readResponseBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    throw new Error(
      `DingTalk file too large: Content-Length ${contentLength} exceeds ${maxBytes} bytes`,
    );
  }

  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new Error(
        `DingTalk file too large: downloaded ${arrayBuffer.byteLength} exceeds ${maxBytes} bytes`,
      );
    }
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`DingTalk file too large: streamed ${total} exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/**
 * Resolve robot inbound file downloadCode → temporary HTTPS URL, then fetch bytes.
 * robotCode is required by the OpenAPI and must match the robot that received the message.
 * @see https://open.dingtalk.com/document/orgapp/download-the-file-content-of-the-robot-receiving-message
 */
export async function downloadDingTalkRobotFile(params: {
  clientId: string;
  clientSecret: string;
  downloadCode: string;
  /** Max bytes to accept after download (default DINGTALK_MAX_ROBOT_FILE_BYTES). */
  maxBytes?: number;
  /** Required — robot that received the inbound message (callback robotCode). */
  robotCode: string;
  timeoutMs?: number;
}): Promise<Buffer> {
  const {
    clientId,
    clientSecret,
    downloadCode,
    maxBytes = DINGTALK_MAX_ROBOT_FILE_BYTES,
    robotCode,
    timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  } = params;
  if (!downloadCode?.trim()) throw new Error('DingTalk downloadCode is required');
  if (!robotCode?.trim()) throw new Error('DingTalk robotCode is required');

  const token = await getDingTalkAccessToken(clientId, clientSecret);
  const resolveCtrl = new AbortController();
  const resolveTimer = setTimeout(() => resolveCtrl.abort(), timeoutMs);
  let result: { downloadUrl?: string; download_url?: string };
  try {
    const response = await fetch(MESSAGE_FILE_DOWNLOAD, {
      body: JSON.stringify({ downloadCode, robotCode }),
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      method: 'POST',
      signal: resolveCtrl.signal,
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      throw new Error(`DingTalk messageFiles/download failed: HTTP ${response.status} ${text}`);
    }
    try {
      result = JSON.parse(text) as { downloadUrl?: string; download_url?: string };
    } catch {
      throw new Error(`DingTalk messageFiles/download returned non-JSON: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`DingTalk messageFiles/download timed out after ${timeoutMs}ms`, {
        cause: err,
      });
    }
    throw err;
  } finally {
    clearTimeout(resolveTimer);
  }

  const downloadUrl = result.downloadUrl || result.download_url;
  if (!downloadUrl) {
    throw new Error('DingTalk messageFiles/download missing downloadUrl');
  }

  const fileCtrl = new AbortController();
  const fileTimer = setTimeout(() => fileCtrl.abort(), timeoutMs);
  try {
    const fileResponse = await fetch(downloadUrl, { signal: fileCtrl.signal });
    if (!fileResponse.ok) {
      throw new Error(`DingTalk file URL fetch failed: HTTP ${fileResponse.status}`);
    }
    return await readResponseBodyWithLimit(fileResponse, maxBytes);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`DingTalk file download timed out after ${timeoutMs}ms`, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(fileTimer);
  }
}
