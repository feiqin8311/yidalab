import { usePathname, useSearchParams } from '@/libs/router/navigation';
import { ProfileTabs, SettingsTabs, SidebarTabKey } from '@/store/global/initialState';

const SIDEBAR_TAB_KEYS = new Set<string>(Object.values(SidebarTabKey));

export const resolveActiveTabKey = (pathname: string): SidebarTabKey =>
  (pathname.split('/').find((segment) => SIDEBAR_TAB_KEYS.has(segment)) as SidebarTabKey) ||
  SidebarTabKey.Home;

/**
 * Returns the active tab key (chat/market/settings/...)
 * React Router version for SPA
 */
export const useActiveTabKey = () => {
  const pathname = usePathname();
  return resolveActiveTabKey(pathname);
};

/**
 * Returns the active setting page key (?active=common/sync/agent/...)
 * React Router version for SPA
 */
export const useActiveSettingsKey = () => {
  const [searchParams] = useSearchParams();
  const tabs = searchParams.get('active');
  if (!tabs) return SettingsTabs.Appearance;
  return tabs as SettingsTabs;
};

/**
 * Returns the active profile page key (profile/security/stats/...)
 * React Router version for SPA
 */
export const useActiveProfileKey = () => {
  const pathname = usePathname();

  const tabs = pathname.split('/').at(-1);

  if (tabs === 'profile') return ProfileTabs.Profile;

  return tabs as ProfileTabs;
};
