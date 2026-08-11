import { beforeEach, describe, expect, it, vi } from 'vitest';

const findByPlatformUser = vi.fn();
const upsertForPlatform = vi.fn();

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: class {
    static findByPlatformUser = (...args: unknown[]) => findByPlatformUser(...args);
    upsertForPlatform = (...args: unknown[]) => upsertForPlatform(...args);
  },
}));

const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));

const mockDb = { select } as any;

describe('resolveDingTalkActor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unlinked when staffId empty', async () => {
    const { resolveDingTalkActor } = await import('./dingtalkIdentity');
    const result = await resolveDingTalkActor({
      db: mockDb,
      staffId: '  ',
      workspaceId: 'ws-1',
    });
    expect(result).toEqual({ kind: 'unlinked' });
  });

  it('uses messenger_account_links when member is active', async () => {
    findByPlatformUser.mockResolvedValue({
      userId: 'user-a',
      workspaceId: 'ws-1',
    });
    // membership check
    selectLimit.mockResolvedValueOnce([{ userId: 'user-a' }]);

    const { resolveDingTalkActor } = await import('./dingtalkIdentity');
    const result = await resolveDingTalkActor({
      db: mockDb,
      staffId: 'staff-1',
      workspaceId: 'ws-1',
    });

    expect(result).toEqual({ kind: 'ok', userId: 'user-a', workspaceId: 'ws-1' });
    expect(findByPlatformUser).toHaveBeenCalledWith(mockDb, 'dingtalk', 'staff-1', 'ws-1');
  });

  it('returns inactive_member when link exists but membership deleted', async () => {
    findByPlatformUser.mockResolvedValue({ userId: 'user-a', workspaceId: 'ws-1' });
    selectLimit.mockResolvedValueOnce([]);

    const { resolveDingTalkActor } = await import('./dingtalkIdentity');
    const result = await resolveDingTalkActor({
      db: mockDb,
      staffId: 'staff-1',
      workspaceId: 'ws-1',
    });
    expect(result).toEqual({ kind: 'inactive_member' });
  });

  it('returns unlinked when no link and no auth account', async () => {
    findByPlatformUser.mockResolvedValue(undefined);
    selectLimit.mockResolvedValueOnce([]); // accounts query

    const { resolveDingTalkActor } = await import('./dingtalkIdentity');
    const result = await resolveDingTalkActor({
      db: mockDb,
      staffId: 'staff-1',
      workspaceId: 'ws-1',
    });
    expect(result).toEqual({ kind: 'unlinked' });
  });
});
