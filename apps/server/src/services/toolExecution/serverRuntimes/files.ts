import { FilesIdentifier, FilesManifest } from '@lobechat/builtin-tool-files';
import { FilesExecutionRuntime } from '@lobechat/builtin-tool-files/executionRuntime';

import { FileModel } from '@/database/models/file';
import { AttachmentExtractService } from '@/server/services/file/attachmentExtract';

import { type ServerRuntimeRegistration } from './types';

export const filesRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const { userId, serverDB, workspaceId, topicId } = context;
    if (!userId || !serverDB) {
      throw new Error('userId and serverDB are required for lobe-files execution');
    }

    const fileModel = new FileModel(serverDB, userId, workspaceId);
    const extractService = new AttachmentExtractService(serverDB, userId, workspaceId);

    /**
     * Fail-closed conversation scope: lobe-files is always-on and must not
     * become a workspace-wide file oracle when topicId is missing.
     */
    const assertTopicScoped = async (fileId: string): Promise<boolean> => {
      if (!topicId) return false;
      const topicFiles = await fileModel.findFilesToInitInSandbox(topicId);
      return topicFiles.some((f) => f.id === fileId);
    };

    return new FilesExecutionRuntime({
      extractFull: async (fileId) => {
        const full = await extractService.extractFull(fileId);
        // Rebuild content from pages when cache stored pages-only.
        const content =
          full.content || (full.pages?.length ? full.pages.map((p) => p.content).join('\n\n') : '');
        return {
          content,
          pages: full.pages,
          parseStatus: full.parseStatus,
          status: full.parseStatus,
          totalLength: full.totalLength || content.length,
          warnings: full.warnings,
        };
      },
      getReadableFile: async (fileId) => {
        if (!(await assertTopicScoped(fileId))) return null;
        const meta = await extractService.inspectMeta(fileId);
        if (!meta) return null;
        return {
          fileType: meta.fileType,
          id: meta.id,
          name: meta.name,
          parseStatus: meta.parseStatus,
          processingPolicy: meta.processingPolicy,
          size: meta.size,
        };
      },
    });
  },
  identifier: FilesManifest.identifier ?? FilesIdentifier,
};
