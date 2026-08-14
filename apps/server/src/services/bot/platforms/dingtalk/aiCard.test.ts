// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getDingTalkAccessToken = vi.hoisted(() => vi.fn());

vi.mock('./api', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, getDingTalkAccessToken };
});

const { createDingTalkAICard, resolveDingTalkAICardTemplateId, updateDingTalkAICard } =
  await import('./aiCard');
const { DINGTALK_REQUEST_TIMEOUT_MS } = await import('./const');

const config = {
  clientId: 'robot-app',
  clientSecret: 'secret',
  templateId: 'tpl-1',
};

describe('DingTalk AI Card API', () => {
  beforeEach(() => {
    getDingTalkAccessToken.mockReset().mockResolvedValue('access-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates and delivers a streaming card to the invoking user', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);

    const cardInstanceId = await createDingTalkAICard({
      config,
      content: '正在思考…',
      userId: 'staff-1',
    });

    expect(cardInstanceId).toMatch(/^yidalab_/);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe('https://api.dingtalk.com/v1.0/card/instances');
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual(
      expect.objectContaining({
        callbackType: 'STREAM',
        cardTemplateId: 'tpl-1',
        outTrackId: cardInstanceId,
      }),
    );
    expect(fetch.mock.calls[1][0]).toBe('https://api.dingtalk.com/v1.0/card/instances/deliver');
    expect(JSON.parse(fetch.mock.calls[1][1].body as string)).toEqual(
      expect.objectContaining({
        openSpaceId: 'dtv1.card//IM_ROBOT.staff-1',
        outTrackId: cardInstanceId,
      }),
    );
    expect(fetch.mock.calls[0][1].headers).toEqual(
      expect.objectContaining({ 'x-acs-dingtalk-access-token': 'access-token' }),
    );
    expect(timeout).toHaveBeenCalledWith(DINGTALK_REQUEST_TIMEOUT_MS);
  });

  it('finalizes streaming content and marks the card flow finished', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);

    await updateDingTalkAICard({
      cardInstanceId: 'yidalab_card-1',
      config,
      content: '# 最终答案',
      finished: true,
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe('https://api.dingtalk.com/v1.0/card/streaming');
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual(
      expect.objectContaining({
        content: '# 最终答案',
        isFinalize: true,
        isFull: true,
        outTrackId: 'yidalab_card-1',
      }),
    );
    expect(fetch.mock.calls[1][0]).toBe('https://api.dingtalk.com/v1.0/card/instances');
    const finishBody = JSON.parse(fetch.mock.calls[1][1].body as string);
    expect(finishBody.cardData.cardParamMap.flowStatus).toBe('3');
  });

  it('resolves a per-provider template before the environment fallback', () => {
    expect(
      resolveDingTalkAICardTemplateId(
        { aiCardTemplateId: ' provider-template ' },
        {
          DINGTALK_AI_CARD_TEMPLATE_ID: 'env-template',
        },
      ),
    ).toBe('provider-template');
    expect(
      resolveDingTalkAICardTemplateId(
        {},
        {
          DINGTALK_AI_CARD_TEMPLATE_ID: ' env-template ',
        },
      ),
    ).toBe('env-template');
  });

  it('surfaces DingTalk API error details', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('permission denied', { status: 403 }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      createDingTalkAICard({ config, content: '正在思考…', userId: 'staff-1' }),
    ).rejects.toThrow('HTTP 403 permission denied');
  });
});
