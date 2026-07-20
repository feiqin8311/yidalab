'use client';

import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { LockIcon, Share2Icon, ShieldIcon, UsersIcon } from 'lucide-react';
import { memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useIsWorkspaceAdmin } from '@/business/client/hooks/useIsWorkspaceAdmin';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import type { ResourceListVisibilityFilter } from '@/routes/(main)/resource/features/store/initialState';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    button: css`
      cursor: pointer;

      display: inline-flex;
      flex: 1;
      gap: 4px;
      align-items: center;
      justify-content: center;

      padding-block: 6px;
      padding-inline: 6px;
      border: none;
      border-radius: ${cssVar.borderRadius};

      font-size: 12px;
      font-weight: 500;
      color: ${cssVar.colorTextSecondary};

      background: transparent;

      transition: background 0.15s;

      &:hover {
        background: ${cssVar.colorFillTertiary};
      }
    `,
    buttonActive: css`
      color: ${cssVar.colorText};
      background: ${cssVar.colorBgElevated};
      box-shadow: 0 1px 2px rgb(0 0 0 / 6%);
    `,
    group: css`
      display: inline-flex;

      width: 100%;
      padding: 3px;
      border-radius: ${cssVar.borderRadiusLG};

      background: ${cssVar.colorFillQuaternary};
    `,
  };
});

const BASE_OPTIONS: Array<{
  icon: typeof LockIcon;
  key: ResourceListVisibilityFilter;
  labelKey: string;
  tooltipKey: string;
}> = [
  {
    icon: LockIcon,
    key: 'private',
    labelKey: 'resources.visibility.private',
    tooltipKey: 'resources.mode.privateHint',
  },
  {
    icon: Share2Icon,
    key: 'shared',
    labelKey: 'resources.visibility.shared',
    tooltipKey: 'resources.mode.sharedHint',
  },
  {
    icon: UsersIcon,
    key: 'workspace',
    labelKey: 'resources.visibility.workspace',
    tooltipKey: 'resources.mode.workspaceHint',
  },
];

const ADMIN_OPTION = {
  icon: ShieldIcon,
  key: 'admin_all' as const,
  labelKey: 'resources.visibility.adminAll',
  tooltipKey: 'resources.mode.adminAllHint',
};

/**
 * Sidebar-top mode toggle: mine / shared with me / company (+ admin all).
 *
 * Rendered only in team-workspace mode. Selecting a mode drives both the list
 * filter (`listVisibility` → `listScope`) and the top-level upload default.
 */
const ResourceModeToggle = memo(() => {
  const { t } = useTranslation('chat');
  const activeWorkspaceId = useActiveWorkspaceId();
  const [listVisibility, setListVisibility, hydrateListVisibility] = useResourceManagerStore(
    (s) => [s.listVisibility, s.setListVisibility, s.hydrateListVisibility],
  );

  const isAdmin = useIsWorkspaceAdmin();

  const options = useMemo(
    () => (isAdmin ? [...BASE_OPTIONS, ADMIN_OPTION] : BASE_OPTIONS),
    [isAdmin],
  );

  const workspaceId = activeWorkspaceId ?? undefined;

  useEffect(() => {
    hydrateListVisibility(workspaceId);
  }, [workspaceId, hydrateListVisibility]);

  // If a non-admin still has admin_all persisted, fall back to mine.
  useEffect(() => {
    if (!isAdmin && listVisibility === 'admin_all' && workspaceId) {
      setListVisibility('private', workspaceId);
    }
  }, [isAdmin, listVisibility, setListVisibility, workspaceId]);

  if (!workspaceId) return null;

  return (
    <Flexbox paddingBlock={6} paddingInline={4}>
      <div className={styles.group} role={'tablist'}>
        {options.map((option) => {
          const isActive = listVisibility === option.key;
          const OptionIcon = option.icon;
          const label = t(option.labelKey as never);
          return (
            <Tooltip key={option.key} title={t(option.tooltipKey as never)}>
              <button
                aria-selected={isActive}
                className={cx(styles.button, isActive && styles.buttonActive)}
                role={'tab'}
                type={'button'}
                onClick={() => {
                  if (isActive) return;
                  setListVisibility(option.key, workspaceId);
                }}
              >
                <Icon icon={OptionIcon} size={14} />
                <span>{label}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </Flexbox>
  );
});

ResourceModeToggle.displayName = 'ResourceModeToggle';

export default ResourceModeToggle;
