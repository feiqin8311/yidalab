import { COMPANY_FEEDBACK_STATUSES } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { CompanyModel } from '@/database/models/company';
import { CompanyFeedbackModel } from '@/database/models/companyFeedback';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const feedbackProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) =>
  next({
    ctx: {
      companyFeedbackModel: new CompanyFeedbackModel(ctx.serverDB, ctx.userId),
      companyModel: new CompanyModel(ctx.serverDB, ctx.userId),
    },
  }),
);

const workspaceIdSchema = z.object({ workspaceId: z.string().min(1) });
const titleSchema = z.string().trim().min(1).max(120);
const contentSchema = z.string().trim().min(1).max(5000);
const statusSchema = z.enum(COMPANY_FEEDBACK_STATUSES);

const ensureMember = async (companyModel: CompanyModel, workspaceId: string) => {
  const membership = await companyModel.getMembership(workspaceId);
  if (!membership) throw new TRPCError({ code: 'FORBIDDEN', message: 'NOT_A_COMPANY_MEMBER' });
  return membership;
};

const ensureManager = async (companyModel: CompanyModel, workspaceId: string) => {
  const membership = await ensureMember(companyModel, workspaceId);
  if (membership.role !== 'admin' && membership.role !== 'owner')
    throw new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_ADMIN_REQUIRED' });
  return membership;
};

const asTrpcError = (error: unknown): never => {
  if (error instanceof TRPCError) throw error;
  const message = error instanceof Error ? error.message : 'FEEDBACK_OPERATION_FAILED';
  const code =
    message === 'FEEDBACK_NOT_FOUND'
      ? 'NOT_FOUND'
      : message === 'FEEDBACK_NOT_AUTHOR'
        ? 'FORBIDDEN'
        : 'BAD_REQUEST';
  throw new TRPCError({ code, message });
};

export const companyFeedbackRouter = router({
  create: feedbackProcedure
    .input(
      workspaceIdSchema.extend({
        content: contentSchema,
        title: titleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const data = await ctx.companyFeedbackModel.create(input);
        return { data, message: 'Created', success: true as const };
      } catch (error) {
        console.error('[companyFeedback:create]', error);
        asTrpcError(error);
      }
    }),

  delete: feedbackProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const row = await ctx.companyFeedbackModel.findById(input.id);
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'FEEDBACK_NOT_FOUND' });
        const membership = await ensureMember(ctx.companyModel, row.workspaceId);
        const isManager = membership.role === 'admin' || membership.role === 'owner';
        if (row.userId !== ctx.userId && !isManager)
          throw new TRPCError({ code: 'FORBIDDEN', message: 'FEEDBACK_DELETE_FORBIDDEN' });
        await ctx.companyFeedbackModel.delete(input.id);
        return { message: 'Deleted', success: true as const };
      } catch (error) {
        console.error('[companyFeedback:delete]', error);
        asTrpcError(error);
      }
    }),

  list: feedbackProcedure
    .input(
      workspaceIdSchema.extend({
        status: statusSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        await ensureMember(ctx.companyModel, input.workspaceId);
        const data = await ctx.companyFeedbackModel.list(input);
        return { data, success: true as const };
      } catch (error) {
        console.error('[companyFeedback:list]', error);
        asTrpcError(error);
      }
    }),

  update: feedbackProcedure
    .input(
      z.object({
        content: contentSchema.optional(),
        id: z.string().min(1),
        title: titleSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const row = await ctx.companyFeedbackModel.findById(input.id);
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'FEEDBACK_NOT_FOUND' });
        await ensureMember(ctx.companyModel, row.workspaceId);
        const data = await ctx.companyFeedbackModel.updateContent(input.id, {
          content: input.content,
          title: input.title,
        });
        return { data, message: 'Updated', success: true as const };
      } catch (error) {
        console.error('[companyFeedback:update]', error);
        asTrpcError(error);
      }
    }),

  updateStatus: feedbackProcedure
    .input(z.object({ id: z.string().min(1), status: statusSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        const row = await ctx.companyFeedbackModel.findById(input.id);
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'FEEDBACK_NOT_FOUND' });
        await ensureManager(ctx.companyModel, row.workspaceId);
        const data = await ctx.companyFeedbackModel.updateStatus(
          input.id,
          input.status,
          ctx.userId,
        );
        return { data, message: 'Status updated', success: true as const };
      } catch (error) {
        console.error('[companyFeedback:updateStatus]', error);
        asTrpcError(error);
      }
    }),
});
