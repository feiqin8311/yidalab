import debug from 'debug';

import { workflowClient } from '@/libs/qstash';

const log = debug('lobe-server:workflows:amazon-old-product-keyword');

const WORKFLOW_PATHS = {
  run: '/api/workflows/amazon-old-product-keyword/run',
  export: '/api/workflows/amazon-old-product-keyword/export',
} as const;

const getWorkflowUrl = (path: string): string => {
  const baseUrl = process.env.APP_URL;
  if (!baseUrl) throw new Error('APP_URL is required to trigger workflows');
  return `${baseUrl.replace(/\/$/, '')}${path}`;
};

export type AmazonKwRunPayload = {
  runId: string;
  userId: string;
  workspaceId: string;
};

export type AmazonKwExportPayload = {
  runId: string;
  userId: string;
  workspaceId: string;
};

export class AmazonOldProductKeywordWorkflow {
  static async triggerRun(payload: AmazonKwRunPayload) {
    log('trigger run %s', payload.runId);
    return workflowClient.trigger({
      body: payload,
      url: getWorkflowUrl(WORKFLOW_PATHS.run),
    });
  }

  static async triggerExport(payload: AmazonKwExportPayload) {
    log('trigger export %s', payload.runId);
    return workflowClient.trigger({
      body: payload,
      url: getWorkflowUrl(WORKFLOW_PATHS.export),
    });
  }
}
