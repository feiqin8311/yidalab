import { TRPCError } from '@trpc/server';

import { CompanyModel } from '@/database/models/company';
import { authedProcedure } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

export type WorkspaceRole = 'member' | 'owner' | 'viewer';

const companyWorkspaceProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  const company = await new CompanyModel(ctx.serverDB, ctx.userId).getMyCompany();

  if (!company) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_REQUIRED' });
  }

  return next({ ctx: { company, workspaceId: company.id } });
});

export const cloudWorkspaceAuth = trpc.middleware(async (opts) => opts.next());

export const lobeWorkspaceAuth = trpc.middleware(async (opts) => opts.next());

export const requireWorkspaceRole = (_minRole: WorkspaceRole) =>
  trpc.middleware(async (opts) => opts.next());

export const requireWorkspaceRoleWhenScoped = (_minRole: WorkspaceRole) =>
  trpc.middleware(async (opts) => opts.next());

export const wsProcedure = companyWorkspaceProcedure;

export const wsMemberProcedure = companyWorkspaceProcedure;

export const wsOwnerProcedure = companyWorkspaceProcedure;

export const wsCompatProcedure = companyWorkspaceProcedure;
