import { Icon } from '@lobehub/ui';
import { type TabBarProps } from '@lobehub/ui/mobile';
import { TabBar } from '@lobehub/ui/mobile';
import { createStaticStyles, cssVar } from 'antd-style';
import { Bot, MessageSquare, User } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useRouter } from '@/libs/router/navigation';
import { SidebarTabKey } from '@/store/global/initialState';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';

const styles = createStaticStyles(({ css }) => ({
  active: css`
    svg {
      fill: color-mix(in srgb, ${cssVar.colorPrimary} 25%, transparent);
    }
  `,
}));

interface Props {
  className?: string;
  tabBarKey?: SidebarTabKey;
}

export default memo<Props>(({ className, tabBarKey }) => {
  const { t } = useTranslation('common');
  const router = useRouter();
  const { showMarket } = useServerConfigStore(featureFlagsSelectors);
  const hidePersonalSettings = useServerConfigStore(serverConfigSelectors.hidePersonalSettings);

  const items: TabBarProps['items'] = useMemo(
    () =>
      [
        {
          icon: (active: boolean) => (
            <Icon className={active ? styles.active : undefined} icon={MessageSquare} />
          ),
          key: SidebarTabKey.Chat,
          onClick: () => {
            router.push('/agent');
          },
          title: t('tab.chat'),
        },
        showMarket && {
          icon: (active: boolean) => (
            <Icon className={active ? styles.active : undefined} icon={Bot} />
          ),
          key: SidebarTabKey.Community,
          onClick: () => {
            router.push('/community');
          },
          title: t('tab.community'),
        },
        // The Setting tab is hidden once the workspace-only settings rollout
        // lands — every entry that used to live under `/settings` is reachable
        // from the workspace settings sidebar instead.
        !hidePersonalSettings && {
          icon: (active: boolean) => (
            <Icon className={active ? styles.active : undefined} icon={User} />
          ),
          key: SidebarTabKey.Setting,
          onClick: () => router.push('/settings/provider/all'),
          title: t('tab.setting'),
        },
      ].filter(Boolean) as TabBarProps['items'],
    [t, hidePersonalSettings, router, showMarket],
  );

  return <TabBar safeArea activeKey={tabBarKey} className={className} items={items} />;
});
