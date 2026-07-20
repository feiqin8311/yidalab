import { BaseExecutor, type BuiltinToolResult, type IBuiltinToolExecutor } from '@lobechat/types';

import { DingpanExecutionRuntime } from '../ExecutionRuntime';
import {
  DingpanApiName,
  DingpanIdentifier,
  type DingpanStatusParams,
  type UploadToDingpanParams,
} from '../types';

const runtime = new DingpanExecutionRuntime();

class DingpanExecutor extends BaseExecutor<typeof DingpanApiName> implements IBuiltinToolExecutor {
  readonly identifier = DingpanIdentifier;
  protected readonly apiEnum = DingpanApiName;

  private toResult = async (
    output: Awaited<ReturnType<DingpanExecutionRuntime['uploadToDingpan']>>,
  ): Promise<BuiltinToolResult> => {
    if (output.success) {
      return { content: output.content, state: output.state, success: true };
    }
    return {
      content: output.content || 'Dingpan tool failed',
      error: {
        message: output.error?.message || output.content || 'Dingpan tool failed',
        type: (output.error as { type?: string } | undefined)?.type || 'PluginServerError',
      },
      success: false,
    };
  };

  uploadToDingpan = async (params: UploadToDingpanParams): Promise<BuiltinToolResult> => {
    return this.toResult(await runtime.uploadToDingpan(params));
  };

  dingpanStatus = async (params: DingpanStatusParams = {}): Promise<BuiltinToolResult> => {
    return this.toResult(await runtime.dingpanStatus(params));
  };
}

export const dingpanExecutor = new DingpanExecutor();
