import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { searchService } from '@/server/services/search';
import { withVaultCredEnv } from '@/server/utils/withVaultCredEnv';

/** Authed + DB so search/crawl can load Settings → Credentials without process restart. */
const searchProcedure = authedProcedure.use(serverDatabase);

export const searchRouter = router({
  crawlPages: searchProcedure
    .input(
      z.object({
        impls: z
          .enum(['browserless', 'exa', 'firecrawl', 'jina', 'naive', 'search1api', 'tavily'])
          .array()
          .optional(),
        urls: z.string().array(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withVaultCredEnv(ctx.userId, ctx.serverDB, () => searchService.crawlPages(input));
    }),

  query: searchProcedure
    .input(
      z.object({
        optionalParams: z
          .object({
            searchCategories: z.array(z.string()).optional(),
            searchEngines: z.array(z.string()).optional(),
            searchTimeRange: z.string().optional(),
          })
          .optional(),
        query: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return withVaultCredEnv(ctx.userId, ctx.serverDB, () =>
        searchService.query(input.query, input.optionalParams),
      );
    }),

  webSearch: searchProcedure
    .input(
      z.object({
        query: z.string(),
        searchCategories: z.array(z.string()).optional(),
        searchEngines: z.array(z.string()).optional(),
        searchTimeRange: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return withVaultCredEnv(ctx.userId, ctx.serverDB, () => searchService.webSearch(input));
    }),
});
