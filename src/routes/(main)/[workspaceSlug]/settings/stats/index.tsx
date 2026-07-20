'use client';

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import { useIsWorkspaceAdmin } from '@/business/client/hooks/useIsWorkspaceAdmin';
import Page from '@/routes/(main)/settings/stats';
import WorkspaceWelcome from '@/routes/(main)/settings/stats/features/overview/WorkspaceWelcome';
import { type UserDisplay } from '@/routes/(main)/settings/stats/types';

/**
 * company.listMembers returns a flat row (username/email/avatar on the member).
 * Older workspace-member shapes nest the profile under `user` — accept both.
 */
interface WorkspaceStatsMember {
  avatar?: string | null;
  deletedAt?: Date | string | null;
  email?: string | null;
  user?: {
    avatar?: string | null;
    email?: string | null;
    username?: string | null;
  } | null;
  userId: string;
  username?: string | null;
}

const memberDisplayName = (member: WorkspaceStatsMember) =>
  member.username || member.user?.username || member.email || member.user?.email || member.userId;

const memberAvatar = (member: WorkspaceStatsMember) => member.avatar ?? member.user?.avatar ?? null;

const WorkspaceStatsSetting = () => {
  const { t } = useTranslation('auth');
  // Owner/admin: full company stats + by-user dimension. Members: self-only
  // data from the API (restrictToCaller / analyticsSelfOnly).
  const isAdmin = useIsWorkspaceAdmin();

  const { data: members = [] } = useFetchWorkspaceMembers({ includeDeleted: true });

  const memberMap = useMemo(() => {
    const map = new Map<string, UserDisplay>();
    for (const m of members) {
      const member = m as WorkspaceStatsMember;
      const name = memberDisplayName(member);
      map.set(member.userId, {
        avatar: memberAvatar(member),
        name: member.deletedAt ? t('usage.activeModels.removedUserName', { name }) : name,
      });
    }
    return map;
  }, [members, t]);

  const resolveUser = useCallback(
    (userId: string): UserDisplay => memberMap.get(userId) ?? { avatar: null, name: userId },
    [memberMap],
  );

  return (
    <Page
      enableUserDimension={isAdmin}
      headerNode={<WorkspaceWelcome />}
      resolveUser={isAdmin ? resolveUser : undefined}
    />
  );
};

WorkspaceStatsSetting.displayName = 'WorkspaceStatsSetting';

export default WorkspaceStatsSetting;
