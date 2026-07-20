import { useWorkspaceState } from '../workspaceState';
import { useActiveWorkspace } from './useActiveWorkspace';

export const getActiveWorkspaceSlug = (): string | null => {
  const { activeWorkspaceId, workspaces } = useWorkspaceState.getState();
  return workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.slug ?? null;
};

export const useActiveWorkspaceSlug = (): string | null => useActiveWorkspace()?.slug ?? null;
