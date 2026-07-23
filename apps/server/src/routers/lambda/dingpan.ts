import { DingpanApiName } from '@lobechat/builtin-tool-dingpan';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { dingpanRuntime } from '@/server/services/toolExecution/serverRuntimes/dingpan';

/**
 * SPA product path bridge: browser agents call dingpan via trpc so vault
 * credentials + document bridge run on the server (withVaultCredEnv).
 */
const dingpanProcedure = wsCompatProcedure.use(serverDatabase);

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
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? null,
      });

      const fn = runtime?.[input.apiName];
      if (typeof fn !== 'function') {
        return {
          content: `Builtin tool "lobe-dingpan" has no API named "${input.apiName}".`,
          error: { message: 'Unknown API', type: 'UNKNOWN_API' },
          success: false,
        };
      }

      try {
        return await fn(input.args ?? {});
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
});

export type DingpanRouter = typeof dingpanRouter;
