import { describe, expect, it } from 'vitest';

import { resolveFbaNotifyUserIds } from './resolveNotifyUserIds';

describe('resolveFbaNotifyUserIds', () => {
  it('uses DingTalk session sender when platform is dingtalk', () => {
    const result = resolveFbaNotifyUserIds({
      botContext: {
        applicationId: 'app',
        isOwner: false,
        platform: 'dingtalk',
        platformThreadId: 'dingtalk:1:c',
        senderExternalUserId: 'sender-42',
      },
      channelOwnerUserId: 'owner-99',
    });
    expect(result).toEqual({
      notifyUserIds: ['sender-42'],
      source: 'dingtalk_sender',
    });
  });

  it('does not fall back to channel owner on empty DingTalk sender', () => {
    const result = resolveFbaNotifyUserIds({
      botContext: {
        applicationId: 'app',
        isOwner: false,
        platform: 'dingtalk',
        platformThreadId: 't',
        senderExternalUserId: '',
      },
      channelOwnerUserId: 'owner-99',
    });
    expect(result.source).toBe('none');
    expect(result.notifyUserIds).toEqual([]);
  });

  it('uses channel owner for web / non-dingtalk entry', () => {
    const result = resolveFbaNotifyUserIds({
      botContext: null,
      channelOwnerUserId: 'owner-99',
    });
    expect(result).toEqual({
      notifyUserIds: ['owner-99'],
      source: 'channel_owner',
    });
  });

  it('returns none when web entry has no owner config', () => {
    const result = resolveFbaNotifyUserIds({ botContext: undefined, channelOwnerUserId: '' });
    expect(result.source).toBe('none');
  });
});
