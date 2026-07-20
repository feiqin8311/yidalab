'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import DataStatistics from '@/features/User/DataStatistics';
import UserInfo from '@/features/User/UserInfo';
import UserLoginOrSignup from '@/features/User/UserLoginOrSignup/Community';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const UserBanner = memo(() => {
  const isLoginWithAuth = useUserStore(authSelectors.isLoginWithAuth);
  const hidePersonalSettings = useServerConfigStore(serverConfigSelectors.hidePersonalSettings);
  const [signIn] = useUserStore((s) => [s.openLogin]);

  // Without the personal settings surface, the banner rows lose their
  // navigation targets. Render plain content in that mode so the me/home page
  // still has a meaningful banner.
  const renderLinks = !hidePersonalSettings;

  return (
    <Flexbox gap={12} paddingBlock={8}>
      {isLoginWithAuth ? (
        renderLinks ? (
          <>
            <WorkspaceLink style={{ color: 'inherit' }} to="/settings/profile">
              <UserInfo />
            </WorkspaceLink>
            <WorkspaceLink style={{ color: 'inherit' }} to="/settings/stats">
              <DataStatistics paddingInline={12} />
            </WorkspaceLink>
          </>
        ) : (
          <>
            <UserInfo />
            <DataStatistics paddingInline={12} />
          </>
        )
      ) : (
        <UserLoginOrSignup
          onClick={() => {
            signIn();
          }}
        />
      )}
    </Flexbox>
  );
});

export default UserBanner;
