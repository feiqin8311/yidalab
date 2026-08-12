/**
 * Internal profile client executors — core tools only.
 * Aliased over `./index.ts` when YIDALAB_BUILD_PROFILE=internal.
 */
import { agentBuilderExecutor } from '@lobechat/builtin-tool-agent-builder/executor';
import { agentManagementExecutor } from '@lobechat/builtin-tool-agent-management/executor';
import { calculatorExecutor } from '@lobechat/builtin-tool-calculator/executor';
import { credsExecutor } from '@lobechat/builtin-tool-creds/executor';
import { groupManagementExecutor } from '@lobechat/builtin-tool-group-management/executor';
import { knowledgeBaseExecutor } from '@lobechat/builtin-tool-knowledge-base/client/executor';
import { lobeAgentExecutor } from '@lobechat/builtin-tool-lobe-agent/client/executor';
import { localSystemExecutor } from '@lobechat/builtin-tool-local-system/client/executor';
import { memoryExecutor } from '@lobechat/builtin-tool-memory/executor';
import { taskExecutor } from '@lobechat/builtin-tool-task/client/executor';

import type { BuiltinToolContext, BuiltinToolResult, IBuiltinToolExecutor } from '../types';
import { activatorExecutor } from './lobe-activator';
import { agentDocumentsExecutor } from './lobe-agent-documents';
import { dingpanExecutor } from './lobe-dingpan';
import { filesExecutor } from './lobe-files';
import { messageExecutor } from './lobe-message';
import { pageAgentExecutor } from './lobe-page-agent';
import { skillStoreExecutor } from './lobe-skill-store';
import { skillsExecutor } from './lobe-skills';
import { topicReferenceExecutor } from './lobe-topic-reference';
import { userInteractionExecutor } from './lobe-user-interaction';
import { webBrowsing } from './lobe-web-browsing';
import { workbookExecutor } from './lobe-workbook';

const executorRegistry = new Map<string, IBuiltinToolExecutor>();
let executorsRegistered = false;

export const getExecutor = (identifier: string): IBuiltinToolExecutor | undefined => {
  return executorRegistry.get(identifier);
};

export const hasExecutor = (identifier: string, apiName: string): boolean => {
  const executor = executorRegistry.get(identifier);
  return executor?.hasApi(apiName) ?? false;
};

export const getRegisteredIdentifiers = (): string[] => {
  return Array.from(executorRegistry.keys());
};

export const getApiNamesForIdentifier = (identifier: string): string[] => {
  const executor = executorRegistry.get(identifier);
  return executor?.getApiNames() ?? [];
};

export const invokeExecutor = async (
  identifier: string,
  apiName: string,
  params: any,
  ctx: BuiltinToolContext,
): Promise<BuiltinToolResult> => {
  await registerBuiltinToolExecutors();

  const executor = executorRegistry.get(identifier);

  if (!executor) {
    return {
      error: {
        message: `Executor not found: ${identifier}`,
        type: 'ExecutorNotFound',
      },
      success: false,
    };
  }

  if (!executor.hasApi(apiName)) {
    return {
      error: {
        message: `API not found: ${identifier}/${apiName}`,
        type: 'ApiNotFound',
      },
      success: false,
    };
  }

  return executor.invoke(apiName, params, ctx);
};

const registerExecutors = (executors: IBuiltinToolExecutor[]): void => {
  for (const executor of executors) {
    executorRegistry.set(executor.identifier, executor);
  }
};

export const registerBuiltinToolExecutors = (): void => {
  if (executorsRegistered) return;

  registerExecutors([
    agentBuilderExecutor,
    agentDocumentsExecutor,
    agentManagementExecutor,
    calculatorExecutor,
    credsExecutor,
    dingpanExecutor,
    filesExecutor,
    workbookExecutor,
    groupManagementExecutor,
    knowledgeBaseExecutor,
    localSystemExecutor,
    memoryExecutor,
    messageExecutor,
    pageAgentExecutor,
    skillStoreExecutor,
    skillsExecutor,
    taskExecutor,
    activatorExecutor,
    topicReferenceExecutor,
    userInteractionExecutor,
    lobeAgentExecutor,
    webBrowsing,
  ]);

  executorsRegistered = true;
};
