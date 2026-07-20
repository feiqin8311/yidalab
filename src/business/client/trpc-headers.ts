import { useWorkspaceState } from './workspaceState';

export const getBusinessTrpcHeaders = async (): Promise<Record<string, string>> => {
  const workspaceId = useWorkspaceState.getState().activeWorkspaceId;
  return workspaceId ? { 'X-Workspace-Id': workspaceId } : {};
};
