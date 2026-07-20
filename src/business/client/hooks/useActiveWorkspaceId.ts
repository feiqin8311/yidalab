import { useWorkspaceState } from '../workspaceState';

export const getActiveWorkspaceId = (): string | null =>
  useWorkspaceState.getState().activeWorkspaceId;

export const useActiveWorkspaceId = (): string | null =>
  useWorkspaceState((state) => state.activeWorkspaceId);
