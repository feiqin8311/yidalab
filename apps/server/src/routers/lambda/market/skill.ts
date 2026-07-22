import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { CompanyMarketSkillModel } from '@/database/models/companyMarketSkill';
import { router } from '@/libs/trpc/lambda';
import { CompanyMarketSkillService } from '@/server/services/companyMarketSkill';
import { SkillImportError } from '@/server/services/skill/errors';
import type { DiscoverSkillDetail, DiscoverSkillItem } from '@/types/discover';
import { SkillSorts } from '@/types/discover';

const companyMarketProcedure = wsCompatProcedure.use(async ({ ctx, next }) => {
  return next({
    ctx: {
      companyMarketSkillModel: new CompanyMarketSkillModel(ctx.serverDB, ctx.workspaceId),
      companyMarketSkillService: new CompanyMarketSkillService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId,
      ),
    },
  });
});

const toSkillItem = (skill: {
  content: string;
  createdAt: Date;
  description: string;
  identifier: string;
  manifest: {
    author?: string | { name?: string };
    category?: string;
    tags?: string[];
    version?: string;
  };
  name: string;
  resources: Record<string, { fileHash: string; size: number }> | null;
  updatedAt: Date;
}): DiscoverSkillItem => ({
  author:
    typeof skill.manifest.author === 'string' ? skill.manifest.author : skill.manifest.author?.name,
  category: skill.manifest.category,
  commentCount: 0,
  createdAt: skill.createdAt.toISOString(),
  description: skill.description,
  identifier: skill.identifier,
  installCount: 0,
  isFeatured: false,
  isOfficial: false,
  isValidated: false,
  name: skill.name,
  ratingCount: 0,
  resourcesCount: Object.keys(skill.resources || {}).length,
  tags: skill.manifest.tags || [],
  updatedAt: skill.updatedAt.toISOString(),
  version: skill.manifest.version || '1.0.0',
});

const toSkillDetail = (
  skill: Parameters<typeof toSkillItem>[0] & { hideContent?: boolean },
  opts?: { isManager?: boolean },
): DiscoverSkillDetail => {
  const item = toSkillItem(skill);
  const author = typeof skill.manifest.author === 'string' ? skill.manifest.author : undefined;

  // If content is hidden and user is not a manager, strip the content
  const isHidden = skill.hideContent && !opts?.isManager;

  return {
    ...item,
    author: { name: author || 'Company' },
    content: isHidden ? '' : skill.content,
    hideContent: skill.hideContent,
    overview: { summary: skill.description },
    resources: skill.resources || {},
    versions: [
      {
        createdAt: skill.updatedAt.toISOString(),
        isLatest: true,
        version: item.version,
      },
    ],
  } as DiscoverSkillDetail;
};

const assertManager = (role: string) => {
  if (role !== 'admin' && role !== 'owner') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_ADMIN_REQUIRED' });
  }
};

export const skillRouter = router({
  delete: companyMarketProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertManager(ctx.company.role);
      try {
        // Unpublish market entry + cascade-uninstall all workspace installs.
        return await ctx.companyMarketSkillService.unpublish(input.identifier);
      } catch (error) {
        if (error instanceof SkillImportError && error.code === 'NOT_FOUND') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'MARKET_SKILL_NOT_FOUND' });
        }
        throw error;
      }
    }),

  getSkillCategories: companyMarketProcedure
    .input(
      z
        .object({
          locale: z.string().optional(),
          q: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => ctx.companyMarketSkillModel.listCategories(input?.q)),

  getSkillDetail: companyMarketProcedure
    .input(
      z.object({
        identifier: z.string(),
        locale: z.string().optional(),
        version: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const skill = await ctx.companyMarketSkillModel.findByIdentifier(input.identifier);
      if (!skill) throw new TRPCError({ code: 'NOT_FOUND', message: 'MARKET_SKILL_NOT_FOUND' });
      const isManager = ctx.company.role === 'admin' || ctx.company.role === 'owner';
      return toSkillDetail(skill, { isManager });
    }),

  getSkillList: companyMarketProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          locale: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
          q: z.string().optional(),
          sort: z.nativeEnum(SkillSorts).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const result = await ctx.companyMarketSkillModel.list({
        ...input,
        sort:
          input?.sort === SkillSorts.CreatedAt
            ? 'createdAt'
            : input?.sort === SkillSorts.Name
              ? 'name'
              : 'updatedAt',
      });

      return {
        currentPage: result.currentPage,
        items: result.items.map(toSkillItem),
        pageSize: result.pageSize,
        totalCount: result.total,
        totalPages: Math.ceil(result.total / result.pageSize),
      };
    }),

  publish: companyMarketProcedure
    .input(z.object({ identifier: z.string().optional(), zipFileId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertManager(ctx.company.role);
      return ctx.companyMarketSkillService.publish(input);
    }),

  updateSkillVisibility: companyMarketProcedure
    .input(z.object({ hideContent: z.boolean(), identifier: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertManager(ctx.company.role);
      const skill = await ctx.companyMarketSkillModel.findByIdentifier(input.identifier);
      if (!skill) throw new TRPCError({ code: 'NOT_FOUND', message: 'MARKET_SKILL_NOT_FOUND' });
      const updated = await ctx.companyMarketSkillModel.update(skill.id, {
        hideContent: input.hideContent,
      });

      // Keep already-installed copies in sync so activateSkill confidentiality
      // tracks the market flag without requiring reinstall.
      try {
        const { AgentSkillModel } = await import('@/database/models/agentSkill');
        const agentSkillModel = new AgentSkillModel(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        const installed = await agentSkillModel.findByIdentifier(input.identifier);
        if (installed && installed.source === 'market') {
          await agentSkillModel.update(installed.id, {
            manifest: {
              ...(installed.manifest as object),
              hideContent: input.hideContent,
            },
          });
        }
      } catch {
        // Best-effort: market flag is source of truth even if install sync fails.
      }

      return updated;
    }),
});
