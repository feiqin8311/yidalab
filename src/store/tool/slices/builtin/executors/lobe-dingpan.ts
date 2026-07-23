/**
 * SPA client executor for lobe-dingpan.
 * Proxies to lambda so vault credentials + document bridge run server-side.
 */
import { DingpanApiName, DingpanIdentifier } from '@lobechat/builtin-tool-dingpan';
import {
  BaseExecutor,
  type BuiltinToolContext,
  type BuiltinToolResult,
  type IBuiltinToolExecutor,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class DingpanClientExecutor
  extends BaseExecutor<typeof DingpanApiName>
  implements IBuiltinToolExecutor
{
  readonly identifier = DingpanIdentifier;
  protected readonly apiEnum = DingpanApiName;

  private call = async (
    apiName: (typeof DingpanApiName)[keyof typeof DingpanApiName],
    params: Record<string, unknown>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      const result = await lambdaClient.dingpan.execute.mutate({
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
        'Dingpan tool failed';

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
        // Never return empty content — empty tool results make the model invent fake URLs.
        content: `Dingpan upload failed: ${message}`,
        error: { message, type: 'DingpanUploadError' },
        success: false,
      };
    }
  };

  uploadHtmlToDingpan = (
    params: Record<string, unknown>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.call(DingpanApiName.uploadHtmlToDingpan, params, ctx);

  uploadToDingpan = (
    params: Record<string, unknown>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.call(DingpanApiName.uploadToDingpan, params, ctx);

  dingpanStatus = (
    params: Record<string, unknown> = {},
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.call(DingpanApiName.dingpanStatus, params, ctx);
}

export const dingpanExecutor = new DingpanClientExecutor();
