import { DATA_SOURCE_ROLES, DEFAULT_THRESHOLDS } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { CompanyModel } from '@/database/models/company';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AmazonOldProductKeywordService } from '@/server/services/amazonOldProductKeyword';
import { LingxingAdsService } from '@/server/services/lingxingAds';
import { AmazonOldProductKeywordWorkflow } from '@/server/workflows/amazonOldProductKeyword';

const businessProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) =>
  next({
    ctx: {
      companyModel: new CompanyModel(ctx.serverDB, ctx.userId),
      lingxingAdsService: new LingxingAdsService(ctx.serverDB),
    },
  }),
);

const workspaceIdSchema = z.object({ workspaceId: z.string().min(1) });

const ensureMember = async (companyModel: CompanyModel, workspaceId: string) => {
  const membership = await companyModel.getMembership(workspaceId);
  if (!membership) throw new TRPCError({ code: 'FORBIDDEN', message: 'NOT_A_COMPANY_MEMBER' });
  return membership;
};

const nonEmpty = z.string().trim().min(1);

const roleSchema = z.enum(DATA_SOURCE_ROLES as unknown as [string, ...string[]]);

const amazonKwService = (ctx: { serverDB: any; userId: string }, workspaceId: string) =>
  new AmazonOldProductKeywordService(ctx.serverDB, ctx.userId, workspaceId);

export const businessFunctionRouter = router({
  lingxingAds: router({
    analyze: businessProcedure
      .input(
        workspaceIdSchema.extend({
          campaignName: nonEmpty.max(500),
          country: nonEmpty.max(100),
          sku: nonEmpty.max(200),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const data = await ctx.lingxingAdsService.analyze({
          campaignName: input.campaignName,
          country: input.country,
          sku: input.sku,
          workspaceId: input.workspaceId,
        });
        return { data, success: true as const };
      }),
  }),

  amazonOldProductKeyword: router({
    createDraft: businessProcedure
      .input(
        workspaceIdSchema.extend({
          mainAsin: nonEmpty.max(20),
          categoryName: nonEmpty.max(50),
          priceUsd: z.number().positive().max(1_000_000),
          model: z.object({ provider: nonEmpty.max(100), model: nonEmpty.max(200) }),
          thresholds: z
            .object({
              targetAcos: z.number().min(0).max(5).optional(),
              highRiskAcos: z.number().min(0).max(5).optional(),
              wasteSpendRatioToPrice: z.number().min(0).max(5).optional(),
              wasteClicks: z.number().int().min(0).max(10_000).optional(),
              highRelevanceScore: z.number().min(0).max(100).optional(),
              coreRelevanceScore: z.number().min(0).max(100).optional(),
            })
            .optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        const run = await service.createDraft({
          mainAsin: input.mainAsin,
          categoryName: input.categoryName,
          priceUsd: input.priceUsd,
          model: input.model,
          thresholds: input.thresholds,
        });
        return { data: run, success: true as const };
      }),

    createUploadUrl: businessProcedure
      .input(
        workspaceIdSchema.extend({
          runId: nonEmpty,
          role: roleSchema,
          fileName: nonEmpty.max(500),
          contentType: z.string().max(200).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        const data = await service.createUploadUrl({
          runId: input.runId,
          role: input.role as any,
          fileName: input.fileName,
          contentType: input.contentType,
        });
        return { data, success: true as const };
      }),

    confirmUpload: businessProcedure
      .input(
        workspaceIdSchema.extend({
          runId: nonEmpty,
          role: roleSchema,
          fileName: nonEmpty.max(500),
          s3Key: nonEmpty.max(1000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        const data = await service.confirmUpload({
          runId: input.runId,
          role: input.role as any,
          fileName: input.fileName,
          s3Key: input.s3Key,
        });
        return { data, success: true as const };
      }),

    guessRoles: businessProcedure
      .input(workspaceIdSchema.extend({ fileNames: z.array(nonEmpty.max(500)).max(50) }))
      .mutation(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        return { data: service.guessRoles(input.fileNames), success: true as const };
      }),

    auditInputs: businessProcedure
      .input(workspaceIdSchema.extend({ runId: nonEmpty }))
      .mutation(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        const data = await service.auditInputs(input.runId);
        return { data, success: true as const };
      }),

    start: businessProcedure
      .input(workspaceIdSchema.extend({ runId: nonEmpty }))
      .mutation(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        const run = await service.start(input.runId);
        try {
          await AmazonOldProductKeywordWorkflow.triggerRun({
            runId: input.runId,
            userId: ctx.userId,
            workspaceId: input.workspaceId,
          });
        } catch (e) {
          // Roll back queued → draft/failed so the user can start again.
          await service.markDispatchFailed(input.runId, e instanceof Error ? e.message : String(e));
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'WORKFLOW_DISPATCH_FAILED',
            cause: e,
          });
        }
        return { data: run, success: true as const };
      }),

    listRuns: businessProcedure
      .input(
        workspaceIdSchema.extend({
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        const data = await service.listRuns(input.limit, input.offset);
        return { data, success: true as const };
      }),

    getRun: businessProcedure
      .input(workspaceIdSchema.extend({ runId: nonEmpty }))
      .query(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        const data = await service.getRun(input.runId);
        return { data, success: true as const };
      }),

    listResultRows: businessProcedure
      .input(
        workspaceIdSchema.extend({
          runId: nonEmpty,
          viewId: nonEmpty.max(50),
          search: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
          sortBy: z.enum(['orders', 'spend', 'score', 'rank', 'createdAt']).optional(),
          sortDir: z.enum(['asc', 'desc']).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        const data = await service.listResultRows(input);
        return { data, success: true as const };
      }),

    cancel: businessProcedure
      .input(workspaceIdSchema.extend({ runId: nonEmpty }))
      .mutation(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        const data = await service.cancel(input.runId);
        return { data, success: true as const };
      }),

    retry: businessProcedure
      .input(workspaceIdSchema.extend({ runId: nonEmpty }))
      .mutation(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        const run = await service.retry(input.runId);
        try {
          await AmazonOldProductKeywordWorkflow.triggerRun({
            runId: input.runId,
            userId: ctx.userId,
            workspaceId: input.workspaceId,
          });
        } catch (e) {
          await service.markDispatchFailed(input.runId, e instanceof Error ? e.message : String(e));
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'WORKFLOW_DISPATCH_FAILED',
            cause: e,
          });
        }
        return { data: run, success: true as const };
      }),

    delete: businessProcedure
      .input(workspaceIdSchema.extend({ runId: nonEmpty }))
      .mutation(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        const data = await service.delete(input.runId);
        return { data, success: true as const };
      }),

    requestExport: businessProcedure
      .input(workspaceIdSchema.extend({ runId: nonEmpty }))
      .mutation(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        const { run, claimed } = await service.requestExport(input.runId);
        if (claimed) {
          try {
            await AmazonOldProductKeywordWorkflow.triggerExport({
              runId: input.runId,
              userId: ctx.userId,
              workspaceId: input.workspaceId,
            });
          } catch (e) {
            // release claim so user can retry export
            await service.releaseExportClaim(
              input.runId,
              e instanceof Error ? e.message : String(e),
            );
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'EXPORT_DISPATCH_FAILED',
              cause: e,
            });
          }
        }
        return { data: run, success: true as const };
      }),

    getExportUrl: businessProcedure
      .input(workspaceIdSchema.extend({ runId: nonEmpty }))
      .query(async ({ ctx, input }) => {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const service = amazonKwService(ctx, input.workspaceId);
        const data = await service.getExportUrl(input.runId);
        return { data, success: true as const };
      }),

    defaultThresholds: businessProcedure.input(workspaceIdSchema).query(async ({ ctx, input }) => {
      await ensureMember(ctx.companyModel, input.workspaceId);
      return { data: DEFAULT_THRESHOLDS, success: true as const };
    }),
  }),
});
