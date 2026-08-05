import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import { serve } from '@upstash/workflow/nextjs';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import { qstashClient } from '@/libs/qstash';
import { AmazonOldProductKeywordService } from '@/server/services/amazonOldProductKeyword';
import type { AmazonKwExportPayload } from '@/server/workflows/amazonOldProductKeyword';

const log = debug('lobe-server:workflows:amazon-kw-export');

export const { POST } = serve<AmazonKwExportPayload>(
  withOtelMetricsForUpstashWorkflows(async (context) => {
    const { runId, userId, workspaceId } = context.requestPayload ?? {};
    log('export runId=%s', runId);
    if (!runId || !userId || !workspaceId) {
      return { success: false, error: 'Missing runId/userId/workspaceId' };
    }

    await context.run('amazon-kw:export-assert-ownership', async () => {
      const db = await getServerDB();
      const { BusinessFunctionRunModel } = await import('@/database/models/businessFunction');
      const runModel = new BusinessFunctionRunModel(db, userId, workspaceId);
      const run = await runModel.findByIdUnscoped(runId);
      if (!run) throw new Error('RUN_NOT_FOUND');
      if (run.userId !== userId || run.workspaceId !== workspaceId) {
        throw new Error('WORKFLOW_PAYLOAD_MISMATCH');
      }
      return { ok: true };
    });

    const result = await context.run('amazon-kw:execute-export', async () => {
      const db = await getServerDB();
      const service = new AmazonOldProductKeywordService(db, userId, workspaceId);
      return service.executeExport(runId);
    });

    return { success: true, result };
  }),
  {
    flowControl: { key: 'amazon-kw.export', parallelism: 3, rate: 1 },
    qstashClient,
  },
);
