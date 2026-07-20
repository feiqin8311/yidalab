import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { Flexbox, Popover, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import AgentItem from '@/features/PageEditor/Copilot/AgentSelector/AgentItem';
import { usePermission } from '@/hooks/usePermission';
import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

interface AssignableAgent {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  isInbox: boolean;
  title: string | null;
  userId: string;
  visibility: 'private' | 'public';
}

interface AssigneeAgentSelectorProps {
  children: ReactNode;
  currentAgentId?: string | null;
  disabled?: boolean;
  onChange?: (agentId: string) => void;
  taskIdentifier?: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  searchInput: css`
    width: 100%;
    padding-block: 6px;
    padding-inline: 10px;
    border: none;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-family: inherit;
    font-size: 13px;
    color: ${cssVar.colorText};

    background: transparent;
    outline: none;

    &::placeholder {
      color: ${cssVar.colorTextPlaceholder};
    }
  `,
  sectionHeader: css`
    padding-block: 4px;
    padding-inline: 8px;

    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const triggerStyle: CSSProperties = {
  alignItems: 'center',
  display: 'inline-flex',
  justifyContent: 'center',
  lineHeight: 1,
};

const AssigneeAgentSelector = memo<AssigneeAgentSelectorProps>(
  ({ children, currentAgentId, disabled, onChange, taskIdentifier }) => {
    const { t } = useTranslation(['chat', 'common', 'topic']);
    const { allowed: canEditTask, reason } = usePermission('create_content');
    const [key, setKey] = useState(0);
    const [search, setSearch] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [open, setOpen] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);

    const updateTask = useTaskStore((s) => s.updateTask);
    const currentUserId = useUserStore(userProfileSelectors.userId);

    const { data: assignablePayload, isLoading } = useSWR(
      // Prefetch when closed if we need to resolve the current title; always
      // load when the picker opens.
      open || currentAgentId ? ['task:listAssignableAgents'] : null,
      async () => {
        const res = await taskService.listAssignableAgents();
        return res?.data ?? [];
      },
      { revalidateOnFocus: false },
    );

    const agents = useMemo<AssignableAgent[]>(
      () => (Array.isArray(assignablePayload) ? assignablePayload : []),
      [assignablePayload],
    );

    const memberInboxes = useMemo(() => agents.filter((a) => a.isInbox), [agents]);
    const otherAgents = useMemo(() => agents.filter((a) => !a.isInbox), [agents]);

    const filteredInboxes = useMemo(() => {
      const q = search.trim().toLowerCase();
      if (!q) return memberInboxes;
      return memberInboxes.filter((a) => (a.title || '').toLowerCase().includes(q));
    }, [memberInboxes, search]);

    const filteredOthers = useMemo(() => {
      const q = search.trim().toLowerCase();
      if (!q) return otherAgents;
      return otherAgents.filter((a) => (a.title || '').toLowerCase().includes(q));
    }, [otherAgents, search]);

    const filteredFlat = useMemo(
      () => [...filteredInboxes, ...filteredOthers],
      [filteredInboxes, filteredOthers],
    );

    useEffect(() => {
      if (search.trim()) {
        setActiveIndex(0);
        return;
      }
      const selectedIdx = filteredFlat.findIndex((a) => a.id === currentAgentId);
      setActiveIndex(selectedIdx >= 0 ? selectedIdx : 0);
    }, [search, filteredFlat, currentAgentId]);

    const handleAgentChange = useCallback(
      (agentId: string) => {
        if (!canEditTask) return;
        if (agentId === currentAgentId) return;
        setKey((k) => k + 1);
        setSearch('');
        setOpen(false);
        if (onChange) {
          onChange(agentId);
          return;
        }
        if (taskIdentifier) {
          void updateTask(taskIdentifier, { assigneeAgentId: agentId });
        }
      },
      [canEditTask, currentAgentId, onChange, taskIdentifier, updateTask],
    );

    const handleSearchKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
        if (filteredFlat.length === 0) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % filteredFlat.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + filteredFlat.length) % filteredFlat.length);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const target = filteredFlat[activeIndex];
          if (target) handleAgentChange(target.id);
        }
      },
      [activeIndex, filteredFlat, handleAgentChange],
    );

    useEffect(() => {
      const list = listRef.current;
      if (!list) return;
      const active = list.querySelector<HTMLElement>(`[data-agent-index="${activeIndex}"]`);
      active?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const renderItems = (list: AssignableAgent[], offset: number) =>
      list.map((agent, i) => {
        const flatIndex = offset + i;
        const title =
          agent.title ||
          (agent.isInbox ? t('inbox.title', { ns: 'chat' }) : t('untitledAgent', { ns: 'chat' }));
        return (
          <div
            data-agent-index={flatIndex}
            key={agent.id}
            onMouseEnter={() => setActiveIndex(flatIndex)}
          >
            <AgentItem
              active={flatIndex === activeIndex}
              agentId={agent.id}
              avatar={agent.avatar || (agent.isInbox ? DEFAULT_INBOX_AVATAR : undefined)}
              agentTitle={
                agent.isInbox && agent.userId === currentUserId
                  ? `${title} (${t('taskList.assigneeSearch.me', { defaultValue: 'me' })})`
                  : title
              }
              onAgentChange={handleAgentChange}
              onClose={() => {
                setKey((k) => k + 1);
                setOpen(false);
              }}
            />
          </div>
        );
      });

    const blocked = disabled || !canEditTask;
    const trigger = blocked ? (
      <Tooltip title={disabled ? t('taskDetail.reassignDisabled', { ns: 'chat' }) : reason}>
        <div
          style={{ ...triggerStyle, cursor: 'not-allowed', opacity: 0.5 }}
          onClick={(e) => e.stopPropagation()}
        >
          <span style={{ pointerEvents: 'none' }}>{children}</span>
        </div>
      </Tooltip>
    ) : (
      <div style={triggerStyle} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    );

    const showSections = filteredInboxes.length > 0 && filteredOthers.length > 0;

    return (
      <Popover
        disabled={blocked}
        key={key}
        open={blocked ? false : open}
        placement="bottomLeft"
        styles={{ content: { padding: 0, width: 280 } }}
        trigger="click"
        content={
          <Suspense fallback={<SkeletonList rows={6} />}>
            <Flexbox onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                className={styles.searchInput}
                placeholder={t('taskList.assigneeSearch.placeholder', { ns: 'chat' })}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
              {isLoading && agents.length === 0 ? (
                <SkeletonList rows={6} />
              ) : filteredFlat.length === 0 ? (
                <Flexbox align={'center'} justify={'center'} padding={16}>
                  <Text fontSize={12} type={'secondary'}>
                    {t('taskList.assigneeSearch.empty', { ns: 'chat' })}
                  </Text>
                </Flexbox>
              ) : (
                <Flexbox
                  gap={4}
                  padding={8}
                  ref={listRef}
                  style={{ maxHeight: '50vh', overflowY: 'auto', width: '100%' }}
                >
                  {showSections ? (
                    <>
                      {filteredInboxes.length > 0 && (
                        <>
                          <div className={styles.sectionHeader}>
                            {t('taskList.assigneeSearch.memberAssistants', {
                              defaultValue: 'Member assistants',
                            })}
                          </div>
                          {renderItems(filteredInboxes, 0)}
                        </>
                      )}
                      {filteredOthers.length > 0 && (
                        <>
                          <div className={styles.sectionHeader}>
                            {t('taskList.assigneeSearch.workspaceAgents', {
                              defaultValue: 'Workspace agents',
                            })}
                          </div>
                          {renderItems(filteredOthers, filteredInboxes.length)}
                        </>
                      )}
                    </>
                  ) : (
                    renderItems(filteredFlat, 0)
                  )}
                </Flexbox>
              )}
            </Flexbox>
          </Suspense>
        }
        onOpenChange={(next) => {
          if (blocked) return;
          setOpen(next);
          if (!next) setSearch('');
        }}
      >
        {trigger}
      </Popover>
    );
  },
);

export default AssigneeAgentSelector;
