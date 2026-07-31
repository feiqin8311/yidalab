import debug from 'debug';

const log = debug('bot-platform:dingtalk:api');

const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
const EMOTION_BASE = 'https://api.dingtalk.com/v1.0/robot/emotion';
const MESSAGE_FILE_DOWNLOAD = 'https://api.dingtalk.com/v1.0/robot/messageFiles/download';

/** Align with workbook parse hard cap — refuse larger robot downloads. */
export const DINGTALK_MAX_ROBOT_FILE_BYTES = 20 * 1024 * 1024;

/** Native "thinking" text-emotion used by DingTalk robot emotion API. */
const ACK_EMOTION = {
  backgroundId: 'im_bg_1',
  emotionId: '2659900',
  emotionName: '🤔思考中',
} as const;

const tokenCache = new Map<string, { expiresAt: number; token: string }>();

export async function getDingTalkAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cached = tokenCache.get(clientId);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const response = await fetch(TOKEN_URL, {
    body: JSON.stringify({ appKey: clientId, appSecret: clientSecret }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
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
