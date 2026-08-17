/**
 * Internal market router: company skill / MCP catalog + personal creds.
 * Public LobeHub marketplace / social / OIDC stay out of this profile.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { publicProcedure, router } from '@/libs/trpc/lambda';

import { credsRouter } from './creds';
import { companyMcpHelpers } from './mcp';
import { skillRouter } from './skill';

export const marketRouter = router({
  creds: credsRouter,
  skill: skillRouter,

  getMcpCategories: publicProcedure
    .input(
      z
        .object({
          locale: z.string().optional(),
          q: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => companyMcpHelpers.getCategories(input?.q)),

  getMcpDetail: publicProcedure
    .input(
      z.object({
        identifier: z.string(),
        locale: z.string().optional(),
        version: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const company = await companyMcpHelpers.getDetail(input.identifier);
      if (company) return company;
      throw new TRPCError({ code: 'NOT_FOUND', message: 'MCP not found' });
    }),

  getMcpList: publicProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          locale: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
          q: z.string().optional(),
          sort: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      companyMcpHelpers.getList({
        category: input?.category,
        page: input?.page,
        pageSize: input?.pageSize,
        q: input?.q,
      }),
    ),

  getMcpManifest: publicProcedure
    .input(
      z.object({
        identifier: z.string(),
        install: z.boolean().optional(),
        locale: z.string().optional(),
        version: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const company = await companyMcpHelpers.getManifest(input.identifier, {
        includeSecrets: input.install === true,
      });
      if (company) return company;
      throw new TRPCError({ code: 'NOT_FOUND', message: 'MCP manifest not found' });
    }),
});
