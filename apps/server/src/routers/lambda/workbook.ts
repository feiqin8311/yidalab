import { WorkbookApiName } from '@lobechat/builtin-tool-workbook';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { workbookRuntime } from '@/server/services/toolExecution/serverRuntimes/workbook';

/**
 * SPA product path bridge: browser agents call lobe-workbook via trpc so
 * WorkbookService (DB + S3 assets) runs on the server.
 */
const workbookProcedure = wsCompatProcedure.use(serverDatabase);

const workbookApiNameSchema = z.enum([
  WorkbookApiName.inspectWorkbook,
  WorkbookApiName.previewSheet,
  WorkbookApiName.querySheet,
]);

export const workbookRouter = router({
  execute: workbookProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        apiName: workbookApiNameSchema,
        args: z.record(z.string(), z.unknown()).optional().default({}),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const runtime = workbookRuntime.factory({
        agentId: input.agentId,
        serverDB: ctx.serverDB,
        topicId: input.topicId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? null,
      });

      const fn = runtime?.[input.apiName];
      if (typeof fn !== 'function') {
        return {
          content: `Builtin tool "lobe-workbook" has no API named "${input.apiName}".`,
          error: { message: 'Unknown API', type: 'UNKNOWN_API' },
          success: false,
        };
      }

      try {
        return await fn(input.args ?? {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[workbook.execute] %s failed: %O', input.apiName, error);
        return {
          content: `Workbook tool failed: ${message}`,
          error: { message, type: 'WorkbookToolError' },
          success: false,
        };
      }
    }),
});

export type WorkbookRouter = typeof workbookRouter;
