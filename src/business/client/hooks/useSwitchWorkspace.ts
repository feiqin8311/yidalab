import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import { useWorkspaceState } from '../workspaceState';
import { useWorkspaces } from './useWorkspaces';

export interface SwitchWorkspaceActions {
  switchWorkspace: (id: string) => Promise<void>;
}

/**
 * Workspace switch invoked from imperative call sites that represent an
 * explicit user choice (e.g. switcher click, wizard landing, accept-invite,
 * post-leave redirect). Implementations may attach side effects appropriate
 * to the user-intent semantics.
 */
export const useSwitchWorkspace = (): SwitchWorkspaceActions => {
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const setActiveWorkspaceId = useWorkspaceState((state) => state.setActiveWorkspaceId);

  return {
    switchWorkspace: useCallback(
      async (id) => {
        const workspace = workspaces.find((item) => item.id === id);
        if (!workspace) return;
        setActiveWorkspaceId(id);
        navigate(`/${workspace.slug}`, { replace: true });
      },
      [navigate, setActiveWorkspaceId, workspaces],
    ),
  };
};

/**
 * Workspace switch invoked from passive reconciliation sources (e.g. URL
 * sync) where the active workspace is being aligned with external state
 * rather than chosen by the user. Implementations must not attach
 * user-intent side effects.
 */
export const useSilentSwitchWorkspace = (): SwitchWorkspaceActions => {
  const setActiveWorkspaceId = useWorkspaceState((state) => state.setActiveWorkspaceId);
  return {
    switchWorkspace: useCallback(async (id) => setActiveWorkspaceId(id), [setActiveWorkspaceId]),
  };
};
