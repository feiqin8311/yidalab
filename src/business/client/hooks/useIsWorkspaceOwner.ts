import { useActiveWorkspace } from './useActiveWorkspace';

export const useIsWorkspaceOwner = (): boolean => useActiveWorkspace()?.role === 'owner';
