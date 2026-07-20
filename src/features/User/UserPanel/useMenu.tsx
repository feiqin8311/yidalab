import { LOBE_CHAT_CLOUD, UTM_SOURCE } from '@lobechat/business-const';
import { Icon } from '@lobehub/ui';
import type { ItemType } from 'antd/es/menu/interface';
import { BrainCircuit, Building2, Cloudy, HardDriveDownload, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import useBusinessMenuItems from '@/business/client/features/User/useBusinessMenuItems';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { type MenuProps } from '@/components/Menu';
import { OFFICIAL_URL } from '@/const/url';
import DataImporter from '@/features/DataImporter';
import { useNavLayout } from '@/hooks/useNavLayout';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const useMenu = () => {
  const { t } = useTranslation(['common', 'setting', 'auth']);
  const { showCloudPromotion, hideDocs } = useServerConfigStore(featureFlagsSelectors);
  const [isLogin, isLoginWithAuth] = useUserStore((s) => [
    authSelectors.isLogin(s),
    authSelectors.isLoginWithAuth(s),
  ]);
  const { userPanel } = useNavLayout();
  const businessMenuItems = useBusinessMenuItems(isLogin);
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  // Company settings is the primary settings surface after join/create company.
  // Personal settings entry is intentionally omitted when a workspace is active
  // (account-only needs stay under company settings / auth flows).
  const workspaceSettingsItem: MenuProps['items'] = activeWorkspaceSlug
    ? [
        {
          icon: <Icon icon={Building2} />,
          key: 'workspace-settings',
          label: (
            <Link to={`/${activeWorkspaceSlug}/settings`}>
              {t('workspaceSetting.entryPoint', { ns: 'setting' })}
            </Link>
          ),
        },
      ]
    : [];

  // Pre-company only: thin memory shortcut if enabled (no full personal settings).
  const settings: MenuProps['items'] =
    !activeWorkspaceSlug && userPanel.showMemory
      ? [
          {
            icon: <Icon icon={BrainCircuit} />,
            key: 'memory',
            label: <Link to="/memory">{t('tab.memory')}</Link>,
          },
        ]
      : [];

  const helps: MenuProps['items'] = [
    showCloudPromotion && {
      icon: <Icon icon={Cloudy} />,
      key: 'cloud',
      label: (
        <a
          href={`${OFFICIAL_URL}?utm_source=${UTM_SOURCE}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t('userPanel.cloud', { name: LOBE_CHAT_CLOUD })}
        </a>
      ),
    },
  ].filter(Boolean) as ItemType[];

  const mainItems = [
    {
      type: 'divider',
    },

    ...(isLogin ? workspaceSettingsItem : []),
    ...(isLogin ? settings : []),
    ...businessMenuItems,
    ...(userPanel.showDataImporter && isLogin
      ? [
          {
            icon: <Icon icon={HardDriveDownload} />,
            key: 'import',
            label: <DataImporter>{t('importData')}</DataImporter>,
          },
          {
            type: 'divider' as const,
          },
        ]
      : []),
    ...(!hideDocs ? helps : []),
  ]
    .filter(Boolean)
    // Remove consecutive dividers to prevent double divider lines
    .filter((item, index, arr) => {
      if (index === 0) return true;
      const isDivider = (i: any) => i && typeof i === 'object' && i.type === 'divider';
      return !(isDivider(item) && isDivider(arr[index - 1]));
    }) as MenuProps['items'];

  const logoutItems: MenuProps['items'] = isLoginWithAuth
    ? [
        {
          icon: <Icon icon={LogOut} />,
          key: 'logout',
          label: <span>{t('signout', { ns: 'auth' })}</span>,
        },
        {
          type: 'divider',
        },
      ]
    : [];

  return { logoutItems, mainItems };
};
