import type { WorkspaceMemberItem } from '@lobechat/database/schemas';

import { useCompanyMembers } from '@/features/Company/hooks';

import { useActiveWorkspaceId } from './useActiveWorkspaceId';

export const useWorkspaceMembers = (): WorkspaceMemberItem[] => {
  const workspaceId = useActiveWorkspaceId();
  return useCompanyMembers(workspaceId ?? undefined).data ?? [];
};
