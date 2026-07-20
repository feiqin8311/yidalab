import { LOBE_CHAT_CLOUD, UTM_SOURCE } from '@lobechat/business-const';
import { OFFICIAL_URL } from '@lobechat/const';
import {
  Book,
  Building2,
  CircleUserRound,
  Cloudy,
  Feather,
  FileClockIcon,
  Settings2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import useBusinessMeCells from '@/business/client/features/User/useBusinessMeCells';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { type CellProps } from '@/components/Cell';
import { openChangelogModal } from '@/components/ChangelogModal';
import { DOCUMENTS, FEEDBACK } from '@/const/index';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const useCategory = () => {
  const navigate = useNavigate();
  const { t } = useTranslation(['common', 'setting', 'auth']);
  const { showCloudPromotion, hideDocs } = useServerConfigStore(featureFlagsSelectors);
  const hidePersonalSettings = useServerConfigStore(serverConfigSelectors.hidePersonalSettings);
  const [isLoginWithAuth] = useUserStore((s) => [authSelectors.isLoginWithAuth(s)]);
  const businessMeCells = useBusinessMeCells();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  const profile: CellProps[] = [
    {
      icon: CircleUserRound,
      key: 'profile',
      label: t('userPanel.profile'),
      onClick: () => navigate('/me/profile'),
    },
  ];

  // Workspace settings entry point — only shown when the user is currently
  // sitting inside a workspace. Renders above the (optional) personal settings
  // cell so the most-traffixed settings surface stays closest to the top.
  const workspaceSettings: CellProps[] = activeWorkspaceSlug
    ? [
        {
          icon: Building2,
          key: 'workspace-settings',
          label: t('workspaceSetting.entryPoint'),
          onClick: () => navigate(`/${activeWorkspaceSlug}/settings`),
        },
      ]
    : [];

  const settings: CellProps[] = hidePersonalSettings
    ? []
    : [
        {
          icon: Settings2,
          key: 'setting',
          label: t('userPanel.setting'),
          onClick: () => navigate('/me/settings'),
        },
        {
          type: 'divider',
        },
      ];

  const helps: CellProps[] = [
    showCloudPromotion && {
      icon: Cloudy,
      key: 'cloud',
      label: t('userPanel.cloud', { name: LOBE_CHAT_CLOUD }),
      onClick: () => window.open(`${OFFICIAL_URL}?utm_source=${UTM_SOURCE}`, '__blank'),
    },
    {
      icon: Book,
      key: 'docs',
      label: t('document'),
      onClick: () => window.open(DOCUMENTS, '__blank'),
    },
    {
      icon: Feather,
      key: 'feedback',
      label: t('feedback'),
      onClick: () => window.open(FEEDBACK, '__blank'),
    },
    {
      icon: FileClockIcon,
      key: 'changelog',
      label: t('changelog'),
      onClick: () => openChangelogModal(),
    },
  ].filter(Boolean) as CellProps[];

  const mainItems = [
    {
      type: 'divider',
    },
    ...(isLoginWithAuth ? profile : []),
    ...(isLoginWithAuth ? workspaceSettings : []),
    ...(isLoginWithAuth ? settings : []),
    ...(isLoginWithAuth ? businessMeCells : []),
    // YidaLab self-host: no official desktop download
    ...(!hideDocs ? helps : []),
  ].filter(Boolean) as CellProps[];

  return mainItems;
};
