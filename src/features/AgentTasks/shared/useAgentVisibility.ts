import useSWR from 'swr';

import { taskService } from '@/services/task';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

/**
 * Reads an agent's visibility for task-create constraints.
 *
 * Prefer the sidebar list (loaded eagerly). Fall back to the shared
 * `listAssignableAgents` cache so private **inbox** assistants still resolve —
 * they may not carry a usable visibility signal from every home-list path.
 * Returns `undefined` when the agent is unknown to the current viewer.
 */
export const useAgentVisibility = (
  agentId: string | null | undefined,
): 'private' | 'public' | undefined => {
  const sidebarVisibility = useHomeStore((s) =>
    agentId ? homeAgentListSelectors.getAgentById(agentId)(s)?.visibility : undefined,
  );

  const { data: assignableAgents } = useSWR(
    agentId && !sidebarVisibility ? ['task:listAssignableAgents'] : null,
    async () => {
      const res = await taskService.listAssignableAgents();
      return res?.data ?? [];
    },
    { revalidateOnFocus: false },
  );

  if (sidebarVisibility === 'private' || sidebarVisibility === 'public') {
    return sidebarVisibility;
  }

  const fromAssignable = agentId
    ? assignableAgents?.find((a) => a.id === agentId)?.visibility
    : undefined;
  return fromAssignable === 'private' || fromAssignable === 'public' ? fromAssignable : undefined;
};
