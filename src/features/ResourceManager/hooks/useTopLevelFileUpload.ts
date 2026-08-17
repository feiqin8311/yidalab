import { useCallback } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useCurrentFolderId } from '@/routes/(main)/resource/features/hooks/useCurrentFolderId';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { listVisibilityToUploadVisibility } from '@/routes/(main)/resource/features/store/listScope';
import { useFileStore } from '@/store/file';

/**
 * Sidebar mode toggle is the source of truth for top-level workspace uploads:
 * company tab → public; everything else → private. Inside a library/folder
 * the server inherits the parent; personal mode has no visibility column.
 */
export const useTopLevelUploadVisibility = () => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const currentFolderId = useCurrentFolderId();
  const libraryId = useResourceManagerStore((s) => s.libraryId);
  const listVisibility = useResourceManagerStore((s) => s.listVisibility);
  const isTopLevelWorkspace = !!activeWorkspaceId && !libraryId && !currentFolderId;

  return isTopLevelWorkspace ? listVisibilityToUploadVisibility(listVisibility) : undefined;
};

/**
 * Shared driver for ResourceManager top-level file uploads.
 */
export const useTopLevelFileUpload = () => {
  const currentFolderId = useCurrentFolderId();
  const libraryId = useResourceManagerStore((s) => s.libraryId);
  const pushDockFileList = useFileStore((s) => s.pushDockFileList);
  const visibility = useTopLevelUploadVisibility();

  return useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      await pushDockFileList(files, libraryId, currentFolderId ?? undefined, visibility);
    },
    [libraryId, currentFolderId, pushDockFileList, visibility],
  );
};
