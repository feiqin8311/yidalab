import debug from 'debug';
import { and, eq, isNull } from 'drizzle-orm';

import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { account } from '@/database/schemas/betterAuth';
import { workspaceMembers } from '@/database/schemas/workspace';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('bot-platform:dingtalk:identity');

export const DINGTALK_PLATFORM = 'dingtalk';

export type DingTalkIdentityResolveResult =
  | { kind: 'ok'; userId: string; workspaceId: string }
  | { kind: 'unlinked' }
  | { kind: 'inactive_member' }
  | { kind: 'conflict' };

/**
 * Resolve a DingTalk single-chat sender (enterprise staff userid) to a
 * workspace member. Prefers `messenger_account_links` (written on DingTalk
 * free-login), then falls back to better-auth `accounts` (provider=dingtalk)
 * + active workspace membership.
 *
 * Never falls back to the bot channel creator — unlinked senders get
 * `unlinked` so the router can refuse to create topics/memory.
 */
export async function resolveDingTalkActor(params: {
  db: LobeChatDatabase;
  /** Enterprise userid / senderStaffId from the robot payload. */
  staffId: string;
  /** Workspace that owns the bot channel / public agent. */
  workspaceId: string;
}): Promise<DingTalkIdentityResolveResult> {
  const staffId = params.staffId.trim();
  if (!staffId || !params.workspaceId) return { kind: 'unlinked' };

  const linked = await MessengerAccountLinkModel.findByPlatformUser(
    params.db,
    DINGTALK_PLATFORM,
    staffId,
    params.workspaceId,
  );

  if (linked) {
    if (linked.workspaceId && linked.workspaceId !== params.workspaceId) {
      log(
        'link workspace mismatch staff=%s linkWs=%s channelWs=%s',
        staffId,
        linked.workspaceId,
        params.workspaceId,
      );
      return { kind: 'conflict' };
    }
    const memberOk = await isActiveWorkspaceMember(params.db, params.workspaceId, linked.userId);
    if (!memberOk) {
      log('linked user not active member staff=%s user=%s', staffId, linked.userId);
      return { kind: 'inactive_member' };
    }
    return { kind: 'ok', userId: linked.userId, workspaceId: params.workspaceId };
  }

  // Fallback: better-auth dingtalk account (unionid or userid as accountId).
  const accounts = await params.db
    .select({ userId: account.userId, accountId: account.accountId })
    .from(account)
    .where(and(eq(account.providerId, DINGTALK_PLATFORM), eq(account.accountId, staffId)))
    .limit(2);

  if (accounts.length > 1) {
    log('multiple accounts for staff=%s', staffId);
    return { kind: 'conflict' };
  }

  const hit = accounts[0];
  if (!hit) return { kind: 'unlinked' };

  const memberOk = await isActiveWorkspaceMember(params.db, params.workspaceId, hit.userId);
  if (!memberOk) {
    log('auth account not active member staff=%s user=%s', staffId, hit.userId);
    return { kind: 'inactive_member' };
  }

  // Best-effort: materialize messenger link for subsequent messages.
  try {
    await new MessengerAccountLinkModel(params.db, hit.userId).upsertForPlatform({
      platform: DINGTALK_PLATFORM,
      platformUserId: staffId,
      tenantId: params.workspaceId,
      workspaceId: params.workspaceId,
    });
  } catch (error) {
    log('upsert link after auth fallback failed: %O', error);
  }

  return { kind: 'ok', userId: hit.userId, workspaceId: params.workspaceId };
}

/**
 * On DingTalk free-login success: bind enterprise userid → user for every
 * active workspace membership so bot routing can resolve without re-login.
 */
export async function upsertDingTalkLinksForUser(params: {
  db: LobeChatDatabase;
  staffId: string;
  userId: string;
  /** Optional display name for the link row. */
  platformUsername?: string;
}): Promise<void> {
  const staffId = params.staffId.trim();
  if (!staffId) return;

  const memberships = await params.db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, params.userId), isNull(workspaceMembers.deletedAt)));

  const model = new MessengerAccountLinkModel(params.db, params.userId);
  for (const { workspaceId } of memberships) {
    try {
      await model.upsertForPlatform({
        platform: DINGTALK_PLATFORM,
        platformUserId: staffId,
        platformUsername: params.platformUsername,
        tenantId: workspaceId,
        workspaceId,
      });
    } catch (error) {
      log('upsert login link failed user=%s ws=%s: %O', params.userId, workspaceId, error);
    }
  }
}

async function isActiveWorkspaceMember(
  db: LobeChatDatabase,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}
