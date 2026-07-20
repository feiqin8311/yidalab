import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  DingpanStatusParams,
  DingpanStatusState,
  UploadToDingpanParams,
  UploadToDingpanState,
} from '../types';
import { dingpanConfigStatus, uploadFileToDingpan } from './uploadCore';

/**
 * Dingpan Execution Runtime — pure Node upload via DingTalk Storage API.
 * Default folder / secrets come from process env (server .env or injected creds).
 * Per-call folderLink / spaceId+folderId override the default.
 */
export class DingpanExecutionRuntime {
  async uploadToDingpan(args: UploadToDingpanParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await uploadFileToDingpan({
        filePath: args.filePath,
        folderId: args.folderId,
        folderLink: args.folderLink,
        spaceId: args.spaceId,
        uploadName: args.uploadName,
      });

      if (!result.previewUrl) {
        return {
          content: `Upload committed but no preview URL (fileId missing). name=${result.name}`,
          success: false,
        };
      }

      const state: UploadToDingpanState = {
        fileId: result.fileId,
        filePath: args.filePath,
        name: result.name,
        previewUrl: result.previewUrl,
        success: true,
      };

      return {
        content: JSON.stringify(
          {
            file_id: result.fileId,
            name: result.name,
            preview_url: result.previewUrl,
            success: true,
          },
          null,
          2,
        ),
        state,
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: message,
        error: { message, type: 'DingpanUploadError' },
        success: false,
      };
    }
  }

  async dingpanStatus(_args: DingpanStatusParams = {}): Promise<BuiltinServerRuntimeOutput> {
    const status = dingpanConfigStatus();
    const state: DingpanStatusState = status;
    return {
      content: JSON.stringify(status, null, 2),
      state,
      success: true,
    };
  }
}
