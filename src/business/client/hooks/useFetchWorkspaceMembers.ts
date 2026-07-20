import { useCompanyMembers } from '@/features/Company/hooks';

import { useActiveWorkspaceId } from './useActiveWorkspaceId';

export interface FetchWorkspaceMembersOptions {
  includeDeleted?: boolean;
}

export const useFetchWorkspaceMembers = (_options: FetchWorkspaceMembersOptions = {}) =>
  useCompanyMembers(useActiveWorkspaceId() ?? undefined);
