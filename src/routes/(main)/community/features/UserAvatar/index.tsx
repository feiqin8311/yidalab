'use client';

import { Avatar, Skeleton } from '@lobehub/ui';
import { memo, useCallback } from 'react';

import { useCommunityWorkspaceProfile } from '@/business/client/hooks/useCommunityWorkspaceProfile';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useMarketAuth, useMarketUserProfile } from '@/layout/AuthProvider/MarketAuth';

import { resolveCommunityUserAvatarTarget } from './navigation';

interface UserAvatarProps {
  avatarOverride?: string | null;
}

const UserAvatar = memo<UserAvatarProps>(({ avatarOverride }) => {
  const navigate = useWorkspaceAwareNavigate();
  const {
    avatarUrl: workspaceAvatarUrl,
    isWorkspaceScope,
    username: workspaceUsername,
  } = useCommunityWorkspaceProfile();
  const { isLoading, getCurrentUserInfo } = useMarketAuth();

  const userInfo = getCurrentUserInfo();
  const username = userInfo?.sub;

  // Use SWR to fetch user profile with caching
  const { data: userProfile } = useMarketUserProfile(username);

  const handleAvatarClick = useCallback(() => {
    const profileUserName = userProfile?.userName || userProfile?.namespace;
    const target = resolveCommunityUserAvatarTarget({
      isWorkspaceScope,
      profileUsername: profileUserName,
    });

    if (target) {
      navigate(target);
    }
  }, [isWorkspaceScope, navigate, userProfile?.userName, userProfile?.namespace]);

  if (isLoading) {
    return <Skeleton.Avatar active shape={'square'} size={28} style={{ borderRadius: 6 }} />;
  }

  // Get avatar from user profile (fetched via SWR with caching)
  const avatarUrl =
    avatarOverride ||
    (isWorkspaceScope
      ? workspaceAvatarUrl || workspaceUsername
      : userProfile?.avatarUrl || userProfile?.userName || username);

  return <Avatar avatar={avatarUrl} shape={'square'} size={28} onClick={handleAvatarClick} />;
});

export default UserAvatar;
