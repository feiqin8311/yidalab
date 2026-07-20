import type { WorkspaceItem } from '@lobechat/database/schemas';

import { useActiveWorkspaceId } from './useActiveWorkspaceId';
import { useWorkspaces } from './useWorkspaces';

export type WorkspaceListItem = WorkspaceItem & {
  /**
   * True when the caller is a non-primary member of a workspace whose paid
   * subscription has lapsed. The cloud override of `workspace.list` sets it;
   * open-source stub leaves it absent.
   */
  lockedOut?: boolean;
  plan?: 'business' | 'free' | 'pro';
  role?: string;
};

export const useActiveWorkspace = (): WorkspaceListItem | null => {
  const id = useActiveWorkspaceId();
  const workspaces = useWorkspaces();
  return workspaces.find((workspace) => workspace.id === id) ?? null;
};
