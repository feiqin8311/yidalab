/**
 * SPA client executor for lobe-workbook.
 * Proxies to lambda so WorkbookService (parse assets + query) runs server-side.
 */
import { WorkbookApiName, WorkbookIdentifier } from '@lobechat/builtin-tool-workbook';
import {
  BaseExecutor,
  type BuiltinToolContext,
  type BuiltinToolResult,
  type IBuiltinToolExecutor,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class WorkbookClientExecutor
  extends BaseExecutor<typeof WorkbookApiName>
  implements IBuiltinToolExecutor
{
  readonly identifier = WorkbookIdentifier;
  protected readonly apiEnum = WorkbookApiName;

  private call = async (
    apiName: (typeof WorkbookApiName)[keyof typeof WorkbookApiName],
    params: Record<string, unknown>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      const result = await lambdaClient.workbook.execute.mutate({
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
        'Workbook tool failed';

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
        content: `Workbook tool failed: ${message}`,
        error: { message, type: 'WorkbookToolError' },
        success: false,
      };
    }
  };

  inspectWorkbook = (
    params: Record<string, unknown>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.call(WorkbookApiName.inspectWorkbook, params, ctx);

  previewSheet = (
    params: Record<string, unknown>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.call(WorkbookApiName.previewSheet, params, ctx);

  querySheet = (
    params: Record<string, unknown>,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => this.call(WorkbookApiName.querySheet, params, ctx);
}

export const workbookExecutor = new WorkbookClientExecutor();
