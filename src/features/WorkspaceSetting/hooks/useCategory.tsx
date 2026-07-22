import { isDesktop } from '@lobechat/const';
import { SkillsIcon } from '@lobehub/ui/icons';
import {
  BellIcon,
  Blocks,
  Brain,
  BrainCircuit,
  Building2,
  ChartColumnBigIcon,
  Coins,
  CreditCard,
  Database,
  EllipsisIcon,
  EthernetPort,
  Gift,
  KeyboardIcon,
  KeyIcon,
  KeyRound,
  Map,
  MonitorSmartphoneIcon,
  Palette as PaletteIcon,
  Sparkles,
  TerminalSquare,
  UserRound,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';
import { WorkspaceSettingsTabs } from '@/types/workspaceSettings';

export enum WorkspaceSettingsGroupKey {
  Agent = 'agent',
  General = 'general',
  Subscription = 'subscription',
  System = 'system',
}

export interface WorkspaceSettingCategoryItem {
  href?: string;
  icon: any;
  key: WorkspaceSettingsTabs;
  label: string;
}

export interface WorkspaceSettingCategoryGroup {
  items: WorkspaceSettingCategoryItem[];
  key: WorkspaceSettingsGroupKey;
  title: string;
}

export const useWorkspaceSettingCategory = (): WorkspaceSettingCategoryGroup[] => {
  const { t } = useTranslation('setting');
  const { t: tAuth } = useTranslation('auth');
  const { t: tSubscription } = useTranslation('subscription');

  const mobile = useServerConfigStore((s) => s.isMobile);
  const { showApiKeyManage, showProvider } = useServerConfigStore(featureFlagsSelectors);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  return useMemo(
    () =>
      [
        {
          items: [
            {
              icon: UserRound,
              key: WorkspaceSettingsTabs.Profile,
              label: t('workspaceSetting.tab.profile'),
            },
            {
              icon: ChartColumnBigIcon,
              key: WorkspaceSettingsTabs.Stats,
              label: tAuth('tab.stats'),
            },
            {
              icon: Building2,
              key: WorkspaceSettingsTabs.General,
              label: t('workspaceSetting.tab.general'),
            },
            {
              icon: Users,
              key: WorkspaceSettingsTabs.Members,
              label: t('workspaceSetting.tab.members'),
            },
            {
              icon: PaletteIcon,
              key: WorkspaceSettingsTabs.Appearance,
              label: t('tab.appearance'),
            },
            {
              icon: MonitorSmartphoneIcon,
              key: WorkspaceSettingsTabs.Devices,
              label: t('tab.devices'),
            },
            !mobile && {
              icon: KeyboardIcon,
              key: WorkspaceSettingsTabs.Hotkey,
              label: t('tab.hotkey'),
            },
            enableBusinessFeatures && {
              icon: BellIcon,
              key: WorkspaceSettingsTabs.Notification,
              label: t('tab.notification'),
            },
          ].filter(Boolean) as WorkspaceSettingCategoryItem[],
          key: WorkspaceSettingsGroupKey.General,
          title: t('group.common'),
        },

        // YidaLab: always expose Usage/Quota. SaaS billing tabs stay behind business flag.
        {
          items: [
            { icon: ChartColumnBigIcon, key: WorkspaceSettingsTabs.Usage, label: t('tab.usage') },
            ...(enableBusinessFeatures
              ? [
                  {
                    icon: Map,
                    key: WorkspaceSettingsTabs.Plans,
                    label: tSubscription('tab.plans'),
                  },
                  {
                    icon: Coins,
                    key: WorkspaceSettingsTabs.Credits,
                    label: tSubscription('tab.credits'),
                  },
                  {
                    icon: CreditCard,
                    key: WorkspaceSettingsTabs.Billing,
                    label: tSubscription('tab.billing'),
                  },
                  {
                    icon: Gift,
                    key: WorkspaceSettingsTabs.Referral,
                    label: tSubscription('tab.referral'),
                  },
                ]
              : []),
          ],
          key: WorkspaceSettingsGroupKey.Subscription,
          title: t('group.subscription'),
        },

        {
          items: [
            showProvider && {
              icon: Brain,
              key: WorkspaceSettingsTabs.Provider,
              label: t('tab.provider'),
            },
            {
              icon: Sparkles,
              key: WorkspaceSettingsTabs.ServiceModel,
              label: t('tab.serviceModel'),
            },
            {
              icon: SkillsIcon,
              key: WorkspaceSettingsTabs.Skill,
              label: t('tab.skill'),
            },
            {
              icon: Blocks,
              key: WorkspaceSettingsTabs.Connector,
              label: t('tab.connector'),
            },
            {
              icon: BrainCircuit,
              key: WorkspaceSettingsTabs.Memory,
              label: t('tab.memory'),
            },
            {
              icon: KeyRound,
              key: WorkspaceSettingsTabs.Creds,
              label: t('tab.creds'),
            },
            showApiKeyManage && {
              icon: KeyIcon,
              key: WorkspaceSettingsTabs.APIKey,
              label: tAuth('tab.apikey'),
            },
          ].filter(Boolean) as WorkspaceSettingCategoryItem[],
          key: WorkspaceSettingsGroupKey.Agent,
          title: t('group.aiConfig'),
        },

        {
          items: [
            isDesktop && {
              icon: EthernetPort,
              key: WorkspaceSettingsTabs.Proxy,
              label: t('tab.proxy'),
            },
            isDesktop && {
              icon: TerminalSquare,
              key: WorkspaceSettingsTabs.SystemTools,
              label: t('tab.systemTools'),
            },
            {
              icon: Database,
              key: WorkspaceSettingsTabs.Storage,
              label: t('tab.storage'),
            },
            isDevMode && {
              icon: KeyIcon,
              key: WorkspaceSettingsTabs.APIKey,
              label: tAuth('tab.apikey'),
            },
            {
              icon: EllipsisIcon,
              key: WorkspaceSettingsTabs.Advanced,
              label: t('tab.advanced'),
            },
          ].filter(Boolean) as WorkspaceSettingCategoryItem[],
          key: WorkspaceSettingsGroupKey.System,
          title: t('group.system'),
        },
      ].filter(Boolean) as WorkspaceSettingCategoryGroup[],
    [
      t,
      tAuth,
      tSubscription,
      enableBusinessFeatures,
      mobile,
      showApiKeyManage,
      showProvider,
      isDevMode,
    ],
  );
};
