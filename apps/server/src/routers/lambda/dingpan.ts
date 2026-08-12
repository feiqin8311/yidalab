import { DingpanApiName } from '@lobechat/builtin-tool-dingpan';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { DeliveryAttemptModel } from '@/database/models/deliveryAttempt';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { recordDeliveryMetric } from '@/server/services/delivery/metrics';
import { dingpanRuntime } from '@/server/services/toolExecution/serverRuntimes/dingpan';

/**
 * SPA product path bridge: browser agents call dingpan via trpc so vault
 * credentials + document bridge run on the server (withVaultCredEnv).
 * Also exposes delivery outbox list/redrive for trusted-delivery repair.
 */
const dingpanProcedure = wsCompatProcedure.use(serverDatabase);

const assertCompanyManager = (role: string | undefined) => {
  if (role !== 'owner' && role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_ADMIN_REQUIRED' });
  }
};

const dingpanApiNameSchema = z.enum([
  DingpanApiName.uploadHtmlToDingpan,
  DingpanApiName.uploadToDingpan,
  DingpanApiName.dingpanStatus,
]);

export const dingpanRouter = router({
  execute: dingpanProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        apiName: dingpanApiNameSchema,
        /** Tool arguments (html / folderLink / …). */
        args: z.record(z.string(), z.unknown()).optional().default({}),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const runtime = dingpanRuntime.factory({
        agentId: input.agentId,
        serverDB: ctx.serverDB,
        topicId: input.topicId,
        toolManifestMap: {},
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? null,
      } as any);

      const fn = runtime?.[input.apiName];
      if (typeof fn !== 'function') {
        return {
          content: `Builtin tool "lobe-dingpan" has no API named "${input.apiName}".`,
          error: { message: 'Unknown API', type: 'UNKNOWN_API' },
          success: false,
        };
      }

      try {
        // Detached method extract drops `this`; re-bind for class runtimes.
        return await fn.call(runtime, input.args ?? {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[dingpan.execute] %s failed: %O', input.apiName, error);
        return {
          content: `Dingpan upload failed: ${message}`,
          error: { message, type: 'DingpanUploadError' },
          success: false,
        };
      }
    }),

  /**
   * List delivery attempts for an operation.
   * Members: own rows only. Managers: any row in workspace.
   */
  listDeliveries: dingpanProcedure
    .input(z.object({ operationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const isManager = ctx.company?.role === 'owner' || ctx.company?.role === 'admin';
      const model = new DeliveryAttemptModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );
      const rows = await model.findByOperationId(input.operationId);
      if (isManager) return rows;
      return rows.filter((r) => r.userId === ctx.userId);
    }),

  /**
   * Manual redrive for a failed/stale delivery attempt.
   * Owner/admin only (force redrive of others' deliveries is repair ops).
   * Members may redrive only their own non-force failed/pending rows.
   */
  redriveDelivery: dingpanProcedure
    .input(
      z.object({
        force: z.boolean().optional(),
        id: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const isManager = ctx.company?.role === 'owner' || ctx.company?.role === 'admin';
      if (input.force && !isManager) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_ADMIN_REQUIRED' });
      }

      const model = new DeliveryAttemptModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );
      const existing = await model.findById(input.id);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'DELIVERY_NOT_FOUND' });
      }
      if (!isManager && existing.userId !== ctx.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'DELIVERY_NOT_OWNER' });
      }

      const row = await model.requestRedrive(input.id, input.force ?? false);
      if (row) {
        recordDeliveryMetric('redrive', 1, {
          deliveryAttemptId: row.id,
          operationId: row.operationId,
          userId: ctx.userId,
        });
      }
      return row;
    }),

  /** Dead letters — workspace managers only. */
  listDeadLetters: dingpanProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      assertCompanyManager(ctx.company?.role);
      const rows = await DeliveryAttemptModel.listDeadLetters(ctx.serverDB, input?.limit ?? 50);
      return rows.filter((r) => {
        if (ctx.workspaceId) return r.workspaceId === ctx.workspaceId;
        return r.userId === ctx.userId && !r.workspaceId;
      });
    }),
});

export type DingpanRouter = typeof dingpanRouter;
