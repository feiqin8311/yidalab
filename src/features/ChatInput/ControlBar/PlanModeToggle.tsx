'use client';

import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ListTodo } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useUpdateAgentConfig } from '@/features/ChatInput/hooks/useUpdateAgentConfig';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    height: 28px;
    padding-inline: 8px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  buttonActive: css`
    color: ${cssVar.colorInfo};
    background: ${cssVar.colorInfoBg};

    &:hover {
      color: ${cssVar.colorInfo};
      background: ${cssVar.colorInfoBgHover};
    }
  `,
  buttonDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: transparent;
    }
  `,
}));

/**
 * Opt-in Plan Mode toggle (Codex / Grok-style collaboration mode).
 * Stores `chatConfig.planMode` so the next turn injects plan instructions.
 */
const PlanModeToggle = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const { allowed: canCreateContent, reason } = usePermission('create_content');

  const isLoading = useAgentStore((s) => agentByIdSelectors.isAgentConfigLoadingById(agentId)(s));
  const planMode = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s).planMode === true,
  );

  const handleToggle = useCallback(async () => {
    if (!canCreateContent || isLoading) return;
    await updateAgentChatConfig({ planMode: !planMode });
  }, [canCreateContent, isLoading, planMode, updateAgentChatConfig]);

  const button = (
    <div
      aria-pressed={planMode}
      role="button"
      className={cx(
        styles.button,
        planMode && styles.buttonActive,
        (!canCreateContent || isLoading) && styles.buttonDisabled,
      )}
      onClick={handleToggle}
    >
      <Icon icon={ListTodo} size={14} />
      <span>{t('planMode.label')}</span>
    </div>
  );

  const title = !canCreateContent
    ? reason
    : planMode
      ? t('planMode.onTooltip')
      : t('planMode.offTooltip');

  return (
    <Tooltip title={title}>
      <Flexbox>{button}</Flexbox>
    </Tooltip>
  );
});

PlanModeToggle.displayName = 'PlanModeToggle';

export default PlanModeToggle;
