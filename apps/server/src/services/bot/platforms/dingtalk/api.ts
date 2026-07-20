import debug from 'debug';

const log = debug('bot-platform:dingtalk:api');

const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
const EMOTION_BASE = 'https://api.dingtalk.com/v1.0/robot/emotion';

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
