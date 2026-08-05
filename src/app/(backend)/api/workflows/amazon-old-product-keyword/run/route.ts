import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import { serve } from '@upstash/workflow/nextjs';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import { qstashClient } from '@/libs/qstash';
import { AmazonOldProductKeywordService } from '@/server/services/amazonOldProductKeyword';
import type { AmazonKwRunPayload } from '@/server/workflows/amazonOldProductKeyword';

const log = debug('lobe-server:workflows:amazon-kw-run');

export const { POST } = serve<AmazonKwRunPayload>(
  withOtelMetricsForUpstashWorkflows(async (context) => {
    const { runId, userId, workspaceId } = context.requestPayload ?? {};
    log('start runId=%s', runId);
    if (!runId || !userId || !workspaceId) {
      return { success: false, error: 'Missing runId/userId/workspaceId' };
    }

    const serviceOf = async () => {
      const db = await getServerDB();
      return new AmazonOldProductKeywordService(db, userId, workspaceId);
    };

    const markFailed = async (e: unknown, stage: string) => {
      const db = await getServerDB();
      const { BusinessFunctionRunModel } = await import('@/database/models/businessFunction');
      const runModel = new BusinessFunctionRunModel(db, userId, workspaceId);
      await runModel.updateById(runId, {
        status: 'failed',
        stage,
        finishedAt: new Date(),
        error: {
          code: 'PIPELINE_FAILED',
          message: e instanceof Error ? e.message : String(e),
          stage,
          retryable: true,
        },
        progress: {
          stage,
          percent: 100,
          message: e instanceof Error ? e.message : String(e),
        },
      });
    };

    // Validate payload ownership against stored run before any work.
    await context.run('amazon-kw:assert-ownership', async () => {
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

    try {
      // Step 1: parse + aggregate (skip inside service if resuming mid-AI)
      const parseResult = await context.run('amazon-kw:parse-aggregate', async () => {
        const service = await serviceOf();
        return service.stepParseAndAggregate(runId);
      });
      if ((parseResult as any)?.canceled) return { success: true, canceled: true };

      // Step 2: product profile (service skips if already present)
      const profileResult = await context.run('amazon-kw:product-profile', async () => {
        const service = await serviceOf();
        return service.stepProductProfile(runId);
      });
      if ((profileResult as any)?.canceled) return { success: true, canceled: true };

      // Step 3: AI batches (resume-aware)
      const batchResult = await context.run('amazon-kw:ai-batches', async () => {
        const service = await serviceOf();
        return service.stepAiBatches(runId);
      });
      if ((batchResult as any)?.canceled) return { success: true, canceled: true };
      if ((batchResult as any)?.failed) return { success: false, failed: true, batchResult };

      // Step 4: materialize + persist
      const finalResult = await context.run('amazon-kw:materialize-persist', async () => {
        const service = await serviceOf();
        return service.stepMaterializeAndPersist(runId);
      });

      return { success: true, result: finalResult };
    } catch (e) {
      await markFailed(e, 'failed');
      throw e;
    }
  }),
  {
    flowControl: { key: 'amazon-kw.run', parallelism: 5, rate: 2 },
    qstashClient,
  },
);
