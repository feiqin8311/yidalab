/**
 * SPA client executor for lobe-files.
 * Proxies to lambda so AttachmentExtractService (topic-scoped inspect/read/search)
 * runs server-side.
 */
import { FilesApiName, FilesIdentifier } from '@lobechat/builtin-tool-files';
import {
  BaseExecutor,
  type BuiltinToolContext,
  type BuiltinToolResult,
  type IBuiltinToolExecutor,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class FilesClientExecutor
  extends BaseExecutor<typeof FilesApiName>
  implements IBuiltinToolExecutor
{
  readonly identifier = FilesIdentifier;
  protected readonly apiEnum = FilesApiName;

  private call = async (
    apiName: (typeof FilesApiName)[keyof typeof FilesApiName],
    params: Record<string, unknown>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      const result = await lambdaClient.files.execute.mutate({
        agentId: ctx?.agentId ?? undefined,
        apiName,
        args: params ?? {},
        topicId: ctx?.topicId ?? undefined,
      });

      if (result?.success) {
        return {
          content: result.content ?? '',
          state: result.state,
          success: true,
        };
      }

      const message =
        result?.error?.message ||
        (typeof result?.content === 'string' && result.content) ||
        'Files tool failed';

      return {
        content: typeof result?.content === 'string' && result.content ? result.content : message,
        error: {
          message,
          type: result?.error?.type || 'PluginServerError',
        },
        success: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Files tool failed: ${message}`,
        error: { message, type: 'FilesToolError' },
        success: false,
      };
    }
  };

  inspectAttachment = (
    params: Record<string, unknown>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.call(FilesApiName.inspectAttachment, params, ctx);

  readAttachment = (
    params: Record<string, unknown>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.call(FilesApiName.readAttachment, params, ctx);

  searchAttachment = (
    params: Record<string, unknown>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.call(FilesApiName.searchAttachment, params, ctx);
}

export const filesExecutor = new FilesClientExecutor();
