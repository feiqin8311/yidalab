import { workspaces } from '@lobechat/database/schemas';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { CompanyModel } from '@/database/models/company';
import { appEnv } from '@/envs/app';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { EmailService } from '@/server/services/email';

const companyProcedure = authedProcedure
  .use(serverDatabase)
  .use(async ({ ctx, next }) =>
    next({ ctx: { companyModel: new CompanyModel(ctx.serverDB, ctx.userId) } }),
  );
const publicCompanyProcedure = publicProcedure.use(serverDatabase);

const workspaceIdSchema = z.object({ workspaceId: z.string().min(1) });
const departmentNameSchema = z.string().trim().min(1).max(128);
const positionSchema = z.string().trim().min(1).max(128);
const companyNameSchema = z.string().trim().min(1).max(255);
const invitationRoleSchema = z.enum(['admin', 'member']);

const asTrpcError = (error: unknown): never => {
  const message = error instanceof Error ? error.message : 'COMPANY_OPERATION_FAILED';
  const code =
    message === 'COMPANY_NOT_FOUND' || message === 'INVITATION_NOT_FOUND'
      ? 'NOT_FOUND'
      : message === 'ALREADY_IN_COMPANY' || message === 'DEPARTMENT_HAS_MEMBERS'
        ? 'CONFLICT'
        : 'BAD_REQUEST';
  throw new TRPCError({ code, message });
};

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

const ensureOwner = async (companyModel: CompanyModel, workspaceId: string) => {
  const membership = await ensureMember(companyModel, workspaceId);
  if (membership.role !== 'owner')
    throw new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_OWNER_REQUIRED' });
  return membership;
};

const invitationUrl = (token: string) => `${appEnv.APP_URL}/company/invite/${token}`;

const sendInvitationEmail = async ({
  companyName,
  email,
  token,
}: {
  companyName: string;
  email: string;
  token: string;
}) => {
  const url = invitationUrl(token);
  await new EmailService().sendMail({
    html: `<p>You have been invited to join ${companyName} on YidaLab.</p><p><a href="${url}">Accept invitation</a></p>`,
    subject: `Join ${companyName} on YidaLab`,
    text: `You have been invited to join ${companyName} on YidaLab: ${url}`,
    to: email,
  });
};

export const companyRouter = router({
  acceptInvitation: companyProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return { data: await ctx.companyModel.acceptInvitation(input.token), success: true };
      } catch (error) {
        return asTrpcError(error);
      }
    }),

  create: companyProcedure
    .input(
      z.object({
        departmentName: departmentNameSchema,
        name: companyNameSchema,
        position: positionSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return { data: await ctx.companyModel.create(input), success: true };
      } catch (error) {
        return asTrpcError(error);
      }
    }),

  createDepartment: companyProcedure
    .input(workspaceIdSchema.extend({ name: departmentNameSchema }))
    .mutation(async ({ ctx, input }) => {
      await ensureManager(ctx.companyModel, input.workspaceId);
      return {
        data: await ctx.companyModel.createDepartment(input.workspaceId, input.name),
        success: true,
      };
    }),

  delete: companyProcedure.input(workspaceIdSchema).mutation(async ({ ctx, input }) => {
    await ensureOwner(ctx.companyModel, input.workspaceId);
    await ctx.serverDB.delete(workspaces).where(eq(workspaces.id, input.workspaceId));
    return { success: true };
  }),

  deleteDepartment: companyProcedure
    .input(workspaceIdSchema.extend({ departmentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureManager(ctx.companyModel, input.workspaceId);
      try {
        await ctx.companyModel.deleteDepartment(input.workspaceId, input.departmentId);
        return { success: true };
      } catch (error) {
        return asTrpcError(error);
      }
    }),

  getInvitation: publicCompanyProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const invitation = await new CompanyModel(ctx.serverDB, '').findInvitation(input.token);
      if (!invitation) throw new TRPCError({ code: 'NOT_FOUND', message: 'INVITATION_NOT_FOUND' });
      return { data: invitation, success: true };
    }),

  getMine: companyProcedure.query(async ({ ctx }) => ({
    data: await ctx.companyModel.getMyCompany(),
    success: true,
  })),

  leave: companyProcedure.input(workspaceIdSchema).mutation(async ({ ctx, input }) => {
    try {
      await ctx.companyModel.leave(input.workspaceId);
      return { success: true };
    } catch (error) {
      return asTrpcError(error);
    }
  }),

  listDepartments: companyProcedure.input(workspaceIdSchema).query(async ({ ctx, input }) => {
    await ensureMember(ctx.companyModel, input.workspaceId);
    return { data: await ctx.companyModel.listDepartments(input.workspaceId), success: true };
  }),

  listInvitations: companyProcedure.input(workspaceIdSchema).query(async ({ ctx, input }) => {
    await ensureManager(ctx.companyModel, input.workspaceId);
    return { data: await ctx.companyModel.listInvitations(input.workspaceId), success: true };
  }),

  listMembers: companyProcedure.input(workspaceIdSchema).query(async ({ ctx, input }) => {
    await ensureMember(ctx.companyModel, input.workspaceId);
    return { data: await ctx.companyModel.listMembers(input.workspaceId), success: true };
  }),

  listMine: companyProcedure.query(async ({ ctx }) => {
    return { data: await ctx.companyModel.listMineWorkspaces(), success: true };
  }),

  removeMember: companyProcedure
    .input(workspaceIdSchema.extend({ userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const actor = await ensureManager(ctx.companyModel, input.workspaceId);
      const target = await ctx.companyModel.getMembership(input.workspaceId, input.userId);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'MEMBER_NOT_FOUND' });
      if (target.role === 'owner' || (actor.role !== 'owner' && target.role === 'admin'))
        throw new TRPCError({ code: 'FORBIDDEN', message: 'CANNOT_REMOVE_MEMBER' });
      await ctx.companyModel.removeMember(input.workspaceId, input.userId);
      return { success: true };
    }),

  resendInvitation: companyProcedure
    .input(workspaceIdSchema.extend({ invitationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureManager(ctx.companyModel, input.workspaceId);
      const invitation = (await ctx.companyModel.listInvitations(input.workspaceId)).find(
        (item) => item.id === input.invitationId && item.status === 'pending',
      );
      if (!invitation?.email)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'INVITATION_NOT_FOUND' });
      const company = await ctx.companyModel.getMembership(input.workspaceId);
      if (!company) throw new TRPCError({ code: 'NOT_FOUND', message: 'COMPANY_NOT_FOUND' });
      try {
        const mine = await ctx.companyModel.getMyCompany();
        await sendInvitationEmail({
          companyName: mine?.name ?? 'YidaLab company',
          email: invitation.email,
          token: invitation.token,
        });
        return { success: true };
      } catch (error) {
        console.error('[company:resendInvitation]', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'INVITATION_EMAIL_FAILED' });
      }
    }),

  revokeInvitation: companyProcedure
    .input(workspaceIdSchema.extend({ invitationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureManager(ctx.companyModel, input.workspaceId);
      await ctx.companyModel.revokeInvitation(input.workspaceId, input.invitationId);
      return { success: true };
    }),

  sendInvitation: companyProcedure
    .input(
      workspaceIdSchema.extend({
        departmentId: z.string().min(1),
        email: z.string().trim().email(),
        position: positionSchema,
        role: invitationRoleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureManager(ctx.companyModel, input.workspaceId);
      const departments = await ctx.companyModel.listDepartments(input.workspaceId);
      if (!departments.some((department) => department.id === input.departmentId))
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_DEPARTMENT' });
      const invitation = await ctx.companyModel.createInvitation(input);
      const company = await ctx.companyModel.getMyCompany();
      try {
        await sendInvitationEmail({
          companyName: company?.name ?? 'YidaLab company',
          email: input.email,
          token: invitation.token,
        });
      } catch (error) {
        console.error('[company:sendInvitation]', error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'INVITATION_EMAIL_FAILED' });
      }
      return { data: { ...invitation, url: invitationUrl(invitation.token) }, success: true };
    }),

  transferOwnership: companyProcedure
    .input(workspaceIdSchema.extend({ userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ensureOwner(ctx.companyModel, input.workspaceId);
      const target = await ctx.companyModel.getMembership(input.workspaceId, input.userId);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'MEMBER_NOT_FOUND' });
      return {
        data: await ctx.companyModel.transferOwnership(input.workspaceId, input.userId),
        success: true,
      };
    }),

  updateCompany: companyProcedure
    .input(workspaceIdSchema.extend({ name: companyNameSchema }))
    .mutation(async ({ ctx, input }) => {
      await ensureOwner(ctx.companyModel, input.workspaceId);
      return {
        data: await ctx.companyModel.updateCompany(input.workspaceId, input.name),
        success: true,
      };
    }),

  updateDepartment: companyProcedure
    .input(
      workspaceIdSchema.extend({ departmentId: z.string().min(1), name: departmentNameSchema }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureManager(ctx.companyModel, input.workspaceId);
      return {
        data: await ctx.companyModel.updateDepartment(
          input.workspaceId,
          input.departmentId,
          input.name,
        ),
        success: true,
      };
    }),

  updateMember: companyProcedure
    .input(
      workspaceIdSchema.extend({
        departmentId: z.string().min(1),
        position: positionSchema,
        role: z.enum(['admin', 'member']),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = await ensureManager(ctx.companyModel, input.workspaceId);
      const target = await ctx.companyModel.getMembership(input.workspaceId, input.userId);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'MEMBER_NOT_FOUND' });
      if ((target.role === 'owner' || input.role === 'admin') && actor.role !== 'owner')
        throw new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_OWNER_REQUIRED' });
      const departments = await ctx.companyModel.listDepartments(input.workspaceId);
      if (!departments.some((department) => department.id === input.departmentId))
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_DEPARTMENT' });
      return { data: await ctx.companyModel.updateMember(input), success: true };
    }),
});
