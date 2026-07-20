import { create } from 'zustand';

import type { WorkspaceListItem } from './hooks/useActiveWorkspace';

interface WorkspaceState {
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
  setWorkspaces: (workspaces: WorkspaceListItem[]) => void;
  workspaces: WorkspaceListItem[];
}

export const useWorkspaceState = create<WorkspaceState>((set) => ({
  activeWorkspaceId: null,
  setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
  setWorkspaces: (workspaces) =>
    set((state) => ({
      activeWorkspaceId: workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)
        ? state.activeWorkspaceId
        : (workspaces[0]?.id ?? null),
      workspaces,
    })),
  workspaces: [],
}));
