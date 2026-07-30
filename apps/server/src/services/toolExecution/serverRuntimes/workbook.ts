import { WorkbookIdentifier, WorkbookManifest } from '@lobechat/builtin-tool-workbook';
import { WorkbookExecutionRuntime } from '@lobechat/builtin-tool-workbook/executionRuntime';

import { WorkbookService } from '@/server/services/workbook';

import { type ServerRuntimeRegistration } from './types';

export const workbookRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const { userId, serverDB, workspaceId } = context;
    if (!userId || !serverDB) {
      throw new Error('userId and serverDB are required for Workbook execution');
    }
    const service = new WorkbookService(serverDB, userId, workspaceId);
    return new WorkbookExecutionRuntime({
      inspectWorkbook: (fileId) => service.inspectWorkbook(fileId),
      previewSheet: (fileId, sheet, limit) => service.previewSheet(fileId, sheet, limit),
      querySheet: (args) => service.querySheet(args),
    });
  },
  identifier: WorkbookManifest.identifier ?? WorkbookIdentifier,
};
