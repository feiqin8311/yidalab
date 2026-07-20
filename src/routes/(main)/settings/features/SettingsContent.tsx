'use client';

import { Fragment, useEffect } from 'react';

import { useMyCompany } from '@/features/Company/hooks';
import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { SettingsTabs } from '@/store/global/initialState';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { componentMap } from './componentMap';

const REDIRECT_MAP: Record<string, string> = {
  [SettingsTabs.About]: SettingsTabs.Profile,
  [SettingsTabs.Common]: SettingsTabs.Appearance,
  [SettingsTabs.ChatAppearance]: SettingsTabs.Appearance,
  [SettingsTabs.Creds]: SettingsTabs.Profile,
  [SettingsTabs.Agent]: SettingsTabs.ServiceModel,
  [SettingsTabs.TTS]: SettingsTabs.ServiceModel,
  [SettingsTabs.Image]: SettingsTabs.ServiceModel,
};

interface SettingsContentProps {
  activeTab?: string;
  mobile?: boolean;
}

const SettingsContent = ({ mobile, activeTab }: SettingsContentProps) => {
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const navigate = useWorkspaceAwareNavigate();
  const { data: company } = useMyCompany();
  const isCompanyAiRestricted = !!company && company.role !== 'admin' && company.role !== 'owner';
  const isCompanyAiTab =
    activeTab === SettingsTabs.Provider || activeTab === SettingsTabs.ServiceModel;

  useEffect(() => {
    if (activeTab && (REDIRECT_MAP[activeTab] || (isCompanyAiRestricted && isCompanyAiTab))) {
      // Legacy aliases map to their current tab; company members are sent back to
      // their profile when they reach the centrally managed AI settings by URL.
      const targetTab = REDIRECT_MAP[activeTab] || SettingsTabs.Profile;
      navigate(`/settings/${targetTab}`, { escape: true, replace: true });
    }
  }, [activeTab, isCompanyAiRestricted, isCompanyAiTab, navigate]);

  const renderComponent = (tab: string) => {
    const Component = componentMap[tab as keyof typeof componentMap] || componentMap.appearance;
    if (!Component) return null;

    const componentProps: { mobile?: boolean } = {};
    if (
      [
        SettingsTabs.ServiceModel,
        SettingsTabs.Provider,
        SettingsTabs.Profile,
        SettingsTabs.Stats,
        SettingsTabs.Usage,
        SettingsTabs.Security,
        ...(enableBusinessFeatures
          ? [SettingsTabs.Plans, SettingsTabs.Credits, SettingsTabs.Billing, SettingsTabs.Referral]
          : []),
      ].includes(tab as any)
    ) {
      componentProps.mobile = mobile;
    }

    return <Component {...componentProps} />;
  };

  if (activeTab && (REDIRECT_MAP[activeTab] || (isCompanyAiRestricted && isCompanyAiTab))) {
    return null;
  }

  if (mobile) {
    return activeTab ? renderComponent(activeTab) : renderComponent(SettingsTabs.Profile);
  }

  return (
    <>
      {Object.keys(componentMap).map((tabKey) => {
        const isFullWidth =
          tabKey === SettingsTabs.Provider ||
          tabKey === SettingsTabs.Skill ||
          tabKey === SettingsTabs.Connector;
        if (activeTab !== tabKey) return null;
        const content = renderComponent(tabKey);
        if (isFullWidth) return <Fragment key={tabKey}>{content}</Fragment>;
        return (
          <Fragment key={tabKey}>
            <NavHeader />
            <SettingContainer maxWidth={1024} paddingBlock={'24px 128px'} paddingInline={24}>
              {content}
            </SettingContainer>
          </Fragment>
        );
      })}
    </>
  );
};

export default SettingsContent;
