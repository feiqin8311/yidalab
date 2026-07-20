import { DEFAULT_AVATAR } from '@lobechat/const';
import { cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { taskService } from '@/services/task';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { isInboxAgentId } from './isInboxAgent';

interface AgentDisplayMeta {
  avatar: string;
  backgroundColor: string;
  title: string;
}

interface UseAgentDisplayMetaOptions {
  fallbackToDefault?: boolean;
}

/**
 * Resolves agent display metadata from agent store with sidebar data as fallback.
 * The agent store only contains agents the user has actively visited, so sidebar
 * data (loaded eagerly) fills the gap for agents not yet in the store.
 * Task assignees may also be colleague inboxes (not on the sidebar) — those
 * resolve via the shared assignable-agents cache.
 */
export const useAgentDisplayMeta = (
  agentId: string | null | undefined,
  { fallbackToDefault = true }: UseAgentDisplayMetaOptions = {},
): AgentDisplayMeta | undefined => {
  const { t } = useTranslation(['chat', 'common']);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const meta = useAgentStore((s) =>
    agentId ? agentSelectors.getAgentMetaById(agentId)(s) : undefined,
  );
  const sidebarAgent = useHomeStore(homeAgentListSelectors.getAgentById(agentId ?? ''));

  const { data: assignableAgents } = useSWR(
    agentId && !meta?.title?.trim() && !sidebarAgent ? ['task:listAssignableAgents'] : null,
    async () => {
      const res = await taskService.listAssignableAgents();
      return res?.data ?? [];
    },
    { revalidateOnFocus: false },
  );

  if (!agentId) return undefined;

  const assignable = assignableAgents?.find((a) => a.id === agentId);
  const isInbox = isInboxAgentId(agentId, inboxAgentId) || !!assignable?.isInbox;
  const sidebarAvatar = typeof sidebarAgent?.avatar === 'string' ? sidebarAgent.avatar : undefined;
  const hasResolvedMeta =
    isInbox ||
    !!meta?.avatar ||
    !!meta?.backgroundColor ||
    !!meta?.title?.trim() ||
    !!sidebarAgent ||
    !!assignable;

  if (!fallbackToDefault && !hasResolvedMeta) return undefined;

  return {
    avatar:
      meta?.avatar ||
      sidebarAvatar ||
      assignable?.avatar ||
      (isInbox ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR),
    backgroundColor:
      meta?.backgroundColor ||
      sidebarAgent?.backgroundColor ||
      assignable?.backgroundColor ||
      cssVar.colorBgContainer,
    title:
      meta?.title?.trim() ||
      sidebarAgent?.title ||
      assignable?.title ||
      (isInbox ? t('inbox.title', { ns: 'chat' }) : t('defaultSession', { ns: 'common' })),
  };
};
