import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { UsageRecordService } from '@/server/services/usage';

const usageProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  // company.role is set by companyWorkspaceProcedure (wsCompatProcedure).
  const role = (ctx as { company?: { role?: string } }).company?.role;
  const canViewWorkspaceUsage = role === 'owner' || role === 'admin';
  return opts.next({
    ctx: {
      canViewWorkspaceUsage,
      usageRecordService: new UsageRecordService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
        // Members only see their own company usage; admins/owners see everyone.
        { restrictToCaller: !!ctx.workspaceId && !canViewWorkspaceUsage },
      ),
    },
  });
});

export const usageRouter = router({
  getAgentUsageStats: usageProcedure
    .input(
      z.object({
        agentId: z.string(),
        endAt: z.string(),
        granularity: z.enum(['day', 'week']).default('day'),
        startAt: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.getAgentUsageStats(
        input.agentId,
        input.startAt,
        input.endAt,
        input.granularity,
      );
    }),

  findAndGroupByDateRange: usageProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        endAt: z.string(),
        startAt: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAndGroupByDateRange(
        input.startAt,
        input.endAt,
        input.agentId,
      );
    }),

  findAndGroupByDay: usageProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        mo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findAndGroupByDay(input.mo, input.agentId);
    }),

  findByMonth: usageProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        mo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.findByMonth(input.mo, input.agentId);
    }),

  getToolUsageStats: usageProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        endAt: z.string(),
        startAt: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return await ctx.usageRecordService.getToolUsageStats(
        input.startAt,
        input.endAt,
        input.agentId,
      );
    }),
});
