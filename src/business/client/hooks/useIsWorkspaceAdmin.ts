import { useActiveWorkspace } from './useActiveWorkspace';

/** True when the active workspace role is owner or admin. */
export const useIsWorkspaceAdmin = (): boolean => {
  const role = useActiveWorkspace()?.role;
  return role === 'owner' || role === 'admin';
};
