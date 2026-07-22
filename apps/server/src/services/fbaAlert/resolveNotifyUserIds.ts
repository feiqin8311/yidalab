import type { ChatTopicBotContext } from '@lobechat/types';

export type FbaNotifyIdentitySource = 'dingtalk_sender' | 'channel_owner' | 'none';

export interface ResolveFbaNotifyUserIdsInput {
  /**
   * Topic / op bot context when the run came from a message channel.
   * DingTalk sessions set `platform === 'dingtalk'` and `senderExternalUserId`.
   */
  botContext?: ChatTopicBotContext | null;
  /**
   * Advanced settings `userId` from the agent's DingTalk message channel
   * (Owner). Used only when the request is **not** from a DingTalk session
   * (e.g. YidaLab web SPA).
   */
  channelOwnerUserId?: string | null;
}

export interface ResolveFbaNotifyUserIdsResult {
  notifyUserIds: string[];
  /**
   * Human-readable reason when `source === 'none'` so the caller can surface
   * a clear error (missing channel Owner config, empty sender, etc.).
   */
  reason?: string;
  source: FbaNotifyIdentitySource;
}

/**
 * Pick DingTalk notify user ids for a personal (mode=self) FBA alert run.
 *
 * Rules (product agreement):
 * - DingTalk session → use message sender (`senderExternalUserId`)
 * - YidaLab frontend (no dingtalk botContext) → channel advanced settings Owner
 * - Never invent IDs; never fall back to fba-bot default broadcast lists here
 */
export const resolveFbaNotifyUserIds = (
  input: ResolveFbaNotifyUserIdsInput,
): ResolveFbaNotifyUserIdsResult => {
  const bot = input.botContext;
  if (bot?.platform === 'dingtalk') {
    const sender = bot.senderExternalUserId?.trim();
    if (sender) {
      return { notifyUserIds: [sender], source: 'dingtalk_sender' };
    }
    return {
      notifyUserIds: [],
      reason: 'DingTalk session has no senderExternalUserId',
      source: 'none',
    };
  }

  const owner = input.channelOwnerUserId?.trim();
  if (owner) {
    return { notifyUserIds: [owner], source: 'channel_owner' };
  }

  return {
    notifyUserIds: [],
    reason: 'Not a DingTalk session and DingTalk channel advanced settings userId (Owner) is empty',
    source: 'none',
  };
};
