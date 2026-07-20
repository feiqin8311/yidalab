import { useClientDataSWR } from '@/libs/swr';
import { companyService } from '@/services/company';

import { WORKSPACES_KEY } from './useWorkspaces';

export const useIsWorkspaceLoading = (): boolean =>
  useClientDataSWR(WORKSPACES_KEY, () => companyService.listMine()).isLoading;
