import { useClientDataSWR } from '@/libs/swr';
import { companyService } from '@/services/company';

import { useWorkspaceState } from '../workspaceState';
import type { WorkspaceListItem } from './useActiveWorkspace';

export const WORKSPACES_KEY = 'company/workspaces';

export const useWorkspaces = (): WorkspaceListItem[] => {
  const setWorkspaces = useWorkspaceState((state) => state.setWorkspaces);
  const { data } = useClientDataSWR(WORKSPACES_KEY, () => companyService.listMine(), {
    onSuccess: setWorkspaces,
  });
  return data ?? [];
};
