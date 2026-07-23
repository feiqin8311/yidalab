'use client';

import { isDesktop } from '@lobechat/const';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type { HtmlDeliveryMode } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Tabs, type TabsItem } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import React, { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { HtmlDeliveryModeControl } from '@/features/AgentSetting/AgentOpening/HtmlDeliveryMode';
import { OpeningQuestionsControl } from '@/features/AgentSetting/AgentOpening/OpeningQuestions';
import ModelSelect from '@/features/ModelSelect';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';

import EditorCanvas from '../EditorCanvas';
import AgentHeader from './AgentHeader';
import AgentTool from './AgentTool';
import CloudHeterogeneousConfig from './CloudHeterogeneousConfig';
import HeterogeneousAgentStatusCard from './HeterogeneousAgentStatusCard';
import RemoteAgentConfigCard from './RemoteAgentConfigCard';

const styles = createStaticStyles(({ css }) => ({
  configLabel: css`
    font-size: 12px;
    line-height: 1;
    color: ${cssVar.colorTextTertiary};
  `,
  configPanel: css`
    padding-block: 12px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  section: css`
    padding-block-end: 16px;
  `,
  sectionDesc: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  sectionHeader: css`
    max-width: 820px;
  `,
  sectionTitle: css`
    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  topArea: css`
    cursor: default;
    margin-block-end: 28px;
  `,
}));

const ProfileEditor = memo(() => {
  const { t } = useTranslation('setting');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const config = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
  const chatConfig = useAgentStore(chatConfigByIdSelectors.getChatConfigById(agentId), isEqual);
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const updateAgentChatConfigById = useAgentStore((s) => s.updateAgentChatConfigById);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const heterogeneousProvider = config.agencyConfig?.heterogeneousProvider;

  const handleHtmlDeliveryModeChange = useCallback(
    (htmlDeliveryMode: HtmlDeliveryMode) => {
      if (!canEdit || !agentId) return;
      void updateAgentChatConfigById(agentId, { htmlDeliveryMode });
    },
    [agentId, canEdit, updateAgentChatConfigById],
  );

  const handleOpeningQuestionsChange = useCallback(
    (openingQuestions: string[]) => {
      if (!canEdit || !agentId) return;
      void updateAgentConfigById(agentId, { openingQuestions });
    },
    [agentId, canEdit, updateAgentConfigById],
  );

  const updateHeterogeneousCommand = async (command: string) => {
    if (!canEdit) return;
    if (!heterogeneousProvider) return;
    await updateAgentConfigById(agentId, {
      agencyConfig: {
        heterogeneousProvider: { ...heterogeneousProvider, command },
      },
    });
  };

  const updateHeterogeneousEnv = async (env: Record<string, string>) => {
    if (!canEdit) return;
    if (!heterogeneousProvider) return;
    await updateAgentConfigById(agentId, {
      agencyConfig: {
        heterogeneousProvider: { ...heterogeneousProvider, env },
      },
    });
  };

  const updateBoundDeviceId = async (boundDeviceId: string) => {
    await updateAgentConfigById(agentId, {
      agencyConfig: { ...config.agencyConfig, boundDeviceId },
    });
  };

  const isRemoteHetero =
    isHeterogeneous &&
    !!heterogeneousProvider &&
    isRemoteHeterogeneousType(heterogeneousProvider.type);
  const showCloudHeterogeneousTab = heterogeneousProvider?.type === 'claude-code';
  const heterogeneousTabItems: TabsItem[] = heterogeneousProvider
    ? [
        ...(showCloudHeterogeneousTab
          ? [
              {
                key: 'cloud',
                label: t('heterogeneousStatus.cloud.tabLabel'),
                children: (
                  <CloudHeterogeneousConfig
                    provider={heterogeneousProvider}
                    onEnvChange={updateHeterogeneousEnv}
                  />
                ),
              },
            ]
          : []),
        {
          key: 'desktop',
          label: t('heterogeneousStatus.desktop.tabLabel'),
          disabled: !isDesktop,
          children: (
            <HeterogeneousAgentStatusCard
              provider={heterogeneousProvider}
              onCommandChange={updateHeterogeneousCommand}
            />
          ),
        },
      ]
    : [];

  return (
    <>
      <Flexbox
        className={styles.topArea}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {/* Header: Avatar + Name + Description */}
        <AgentHeader />
        {isRemoteHetero && heterogeneousProvider ? (
          // Remote platform agents (openclaw / hermes): show device config panel
          <Flexbox paddingBlock={'8px 0'}>
            <RemoteAgentConfigCard
              provider={heterogeneousProvider}
              onBoundDeviceChange={updateBoundDeviceId}
            />
          </Flexbox>
        ) : isHeterogeneous && heterogeneousProvider ? (
          // Local CLI agents: Claude Code supports cloud config; Codex is desktop-only for now.
          <Tabs
            defaultActiveKey={isDesktop || !showCloudHeterogeneousTab ? 'desktop' : 'cloud'}
            items={heterogeneousTabItems}
            size="small"
          />
        ) : (
          <>
            <Flexbox className={styles.configPanel} gap={10}>
              <div className={styles.configLabel}>{t('settingAgent.runtimeConfig.title')}</div>
              <Flexbox horizontal align={'center'} gap={12} justify={'flex-start'} wrap={'wrap'}>
                <ModelSelect
                  initialWidth
                  disabled={!canEdit}
                  popupWidth={400}
                  value={{
                    model: config.model,
                    provider: config.provider,
                  }}
                  onChange={(value) => {
                    if (!canEdit) return;

                    updateAgentConfigById(agentId, value);
                  }}
                />
                <AgentTool />
              </Flexbox>
              <Flexbox gap={6} style={{ maxWidth: '100%', width: 'fit-content' }}>
                <div className={styles.configLabel}>
                  {t('settingOpening.htmlDeliveryMode.title')}
                </div>
                <HtmlDeliveryModeControl
                  disabled={!canEdit}
                  showLabels={false}
                  // base-ui Select defaults to width:100%; pin like ModelSelect (~content width)
                  style={{ width: 240 }}
                  value={chatConfig.htmlDeliveryMode}
                  onChange={handleHtmlDeliveryModeChange}
                />
              </Flexbox>
            </Flexbox>
          </>
        )}
      </Flexbox>
      {/* Main Content: Prompt Editor — built-in model runtime only. Hetero agents
          (Claude Code / Codex + remote platforms) run an external CLI with its own
          system prompt, so the agent's systemRole never reaches them. Hide the
          editor here to avoid a control that looks effective but isn't (mirrors the
          ModelSelect hiding above). */}
      {!isHeterogeneous && (
        <>
          <EditorCanvas />
          {/* Recommended examples under core instructions — same field as Settings → Opening */}
          <Flexbox
            className={styles.section}
            gap={16}
            onClick={(e) => {
              // Profile page focuses the system-role editor on blank clicks; keep this section isolated.
              e.stopPropagation();
            }}
          >
            <Flexbox className={styles.sectionHeader} gap={4}>
              <div className={styles.sectionTitle}>
                {t('settingOpening.openingQuestions.title')}
              </div>
              <div className={styles.sectionDesc}>{t('settingOpening.openingQuestions.desc')}</div>
            </Flexbox>
            <OpeningQuestionsControl
              disabled={!canEdit}
              value={config.openingQuestions ?? []}
              onChange={handleOpeningQuestionsChange}
            />
          </Flexbox>
        </>
      )}
    </>
  );
});

export default ProfileEditor;
