import { getDingTalkAccessToken } from './api';

const DINGTALK_CARD_API = 'https://api.dingtalk.com/v1.0/card';

const FLOW_STATUS = {
  finished: '3',
  inputting: '2',
} as const;

export interface DingTalkAICardConfig {
  clientId: string;
  clientSecret: string;
  templateId: string;
}

const buildCardData = (content: string, flowStatus: string) => ({
  cardParamMap: {
    config: JSON.stringify({ autoLayout: true }),
    flowStatus,
    msgContent: content,
    staticMsgContent: '',
    sys_full_json_obj: JSON.stringify({ order: ['msgContent'] }),
  },
});

const requestCardApi = async (
  config: DingTalkAICardConfig,
  path: string,
  method: 'POST' | 'PUT',
  body: Record<string, unknown>,
): Promise<void> => {
  const token = await getDingTalkAccessToken(config.clientId, config.clientSecret);
  const response = await fetch(`${DINGTALK_CARD_API}${path}`, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': token,
    },
    method,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`DingTalk AI Card ${path} failed: HTTP ${response.status} ${detail}`.trim());
  }
};

export const createDingTalkAICard = async (params: {
  config: DingTalkAICardConfig;
  content: string;
  userId: string;
}): Promise<string> => {
  const { config, content, userId } = params;
  const cardInstanceId = `yidalab_${crypto.randomUUID()}`;

  await requestCardApi(config, '/instances', 'POST', {
    callbackType: 'STREAM',
    cardData: buildCardData(content, FLOW_STATUS.inputting),
    cardTemplateId: config.templateId,
    imRobotOpenSpaceModel: { supportForward: true },
    outTrackId: cardInstanceId,
  });
  await requestCardApi(config, '/instances/deliver', 'POST', {
    imRobotOpenDeliverModel: {
      extension: { dynamicSummary: 'true' },
      robotCode: config.clientId,
      spaceType: 'IM_ROBOT',
    },
    openSpaceId: `dtv1.card//IM_ROBOT.${userId}`,
    outTrackId: cardInstanceId,
    userIdType: 1,
  });

  return cardInstanceId;
};

export const updateDingTalkAICard = async (params: {
  cardInstanceId: string;
  config: DingTalkAICardConfig;
  content: string;
  finished: boolean;
}): Promise<void> => {
  const { cardInstanceId, config, content, finished } = params;

  await requestCardApi(config, '/streaming', 'PUT', {
    content,
    guid: crypto.randomUUID(),
    isError: false,
    isFinalize: finished,
    isFull: true,
    key: 'msgContent',
    outTrackId: cardInstanceId,
  });

  if (!finished) return;

  await requestCardApi(config, '/instances', 'PUT', {
    cardData: buildCardData(content, FLOW_STATUS.finished),
    cardUpdateOptions: { updateCardDataByKey: true },
    outTrackId: cardInstanceId,
  });
};

export const resolveDingTalkAICardTemplateId = (
  settings: Record<string, unknown>,
  env?: { DINGTALK_AI_CARD_TEMPLATE_ID?: string },
): string | undefined => {
  const configured = settings.aiCardTemplateId;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  return (
    (env?.DINGTALK_AI_CARD_TEMPLATE_ID ?? process.env.DINGTALK_AI_CARD_TEMPLATE_ID)?.trim() ||
    undefined
  );
};
