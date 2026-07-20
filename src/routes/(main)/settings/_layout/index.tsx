'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { WORKSPACE_SETTINGS_TABS } from '@/features/Workspace/workspaceAwarePath';
import SideBar from '@/routes/(main)/settings/_layout/SideBar';

import SettingsContextProvider from './ContextProvider';
import { styles } from './style';

/**
 * Personal `/settings/*` shell. After the user has joined/created a company,
 * mirrored tabs (stats, usage, skill, …) redirect to company settings so the
 * product has one settings surface. Account onboarding (`/settings/company`)
 * and non-mirrored personal tabs remain reachable when needed.
 */
const Layout: FC = () => {
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const { pathname } = useLocation();

  if (activeWorkspaceSlug) {
    const match = /^\/settings\/([^/?#]+)/.exec(pathname);
    const tab = match?.[1];
    // Stay on personal only for company onboarding and tabs without a
    // workspace mirror (if any deep link still hits them).
    if (!tab || WORKSPACE_SETTINGS_TABS.has(tab)) {
      const targetTab = tab && WORKSPACE_SETTINGS_TABS.has(tab) ? tab : 'general';
      return <Navigate replace to={`/${activeWorkspaceSlug}/settings/${targetTab}`} />;
    }
  }

  return (
    <SettingsContextProvider
      value={{
        showOpenAIApiKey: true,
        showOpenAIProxyUrl: true,
      }}
    >
      <SideBar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        <Outlet />
      </Flexbox>
    </SettingsContextProvider>
  );
};

export default Layout;
