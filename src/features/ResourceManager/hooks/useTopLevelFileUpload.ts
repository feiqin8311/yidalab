import { useCallback } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useCurrentFolderId } from '@/routes/(main)/resource/features/hooks/useCurrentFolderId';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { listVisibilityToUploadVisibility } from '@/routes/(main)/resource/features/store/listScope';
import { useFileStore } from '@/store/file';

/**
 * Shared driver for ResourceManager top-level file uploads.
 *
 * The Sidebar mode toggle (`listVisibility`) is the source of truth:
 * - top-level workspace: only the "company" tab uploads as public; others private
 * - inside library/folder: inherit parent on the server
 * - personal mode: no visibility column semantics
 */
export const useTopLevelFileUpload = () => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const currentFolderId = useCurrentFolderId();
  const libraryId = useResourceManagerStore((s) => s.libraryId);
  const listVisibility = useResourceManagerStore((s) => s.listVisibility);
  const pushDockFileList = useFileStore((s) => s.pushDockFileList);

  const isTopLevelWorkspace = !!activeWorkspaceId && !libraryId && !currentFolderId;
  const visibility: 'private' | 'public' | undefined = isTopLevelWorkspace
    ? listVisibilityToUploadVisibility(listVisibility)
    : undefined;

  return useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      await pushDockFileList(files, libraryId, currentFolderId ?? undefined, visibility);
    },
    [libraryId, currentFolderId, pushDockFileList, visibility],
  );
};
