/**
 * Internal profile server runtime registry — YidaLab core tools only.
 * Aliased over `./index.ts` when YIDALAB_BUILD_PROFILE=internal.
 */
import type { ToolExecutionContext } from '../types';
import { activatorRuntime } from './activator';
import { agentBuilderRuntime } from './agentBuilder';
import { agentDocumentsRuntime } from './agentDocuments';
import { agentManagementRuntime } from './agentManagement';
import { briefRuntime } from './brief';
import { calculatorRuntime } from './calculator';
import { credsRuntime } from './creds';
import { dingpanRuntime } from './dingpan';
import { fbaAlertRuntime } from './fbaAlert';
import { filesRuntime } from './files';
import { groupManagementRuntime } from './groupManagement';
import { knowledgeBaseRuntime } from './knowledgeBase';
import { lobeAgentRuntime } from './lobeAgent';
import { lobeDeliveryCheckerRuntime } from './lobeDeliveryChecker';
import { localSystemRuntime } from './localSystem';
import { memoryRuntime } from './memory';
import { messageRuntime } from './message';
import { pageAgentRuntime } from './pageAgent';
import { skillManagementRuntime } from './skillManagement';
import { skillsRuntime } from './skills';
import { skillStoreRuntime } from './skillStore';
import { taskRuntime } from './task';
import { topicReferenceRuntime } from './topicReference';
import type { ServerRuntimeFactory, ServerRuntimeRegistration } from './types';
import { userInteractionRuntime } from './userInteraction';
import { verifyResultRuntime } from './verifyResult';
import { webBrowsingRuntime } from './webBrowsing';
import { workbookRuntime } from './workbook';

const serverRuntimeFactories = new Map<string, ServerRuntimeFactory>();

const registerRuntimes = (runtimes: ServerRuntimeRegistration[]) => {
  for (const runtime of runtimes) {
    serverRuntimeFactories.set(runtime.identifier, runtime.factory);
  }
};

registerRuntimes([
  agentBuilderRuntime,
  webBrowsingRuntime,
  calculatorRuntime,
  agentDocumentsRuntime,
  agentManagementRuntime,
  skillManagementRuntime,
  skillStoreRuntime,
  skillsRuntime,
  memoryRuntime,
  activatorRuntime,
  messageRuntime,
  localSystemRuntime,
  briefRuntime,
  taskRuntime,
  topicReferenceRuntime,
  userInteractionRuntime,
  credsRuntime,
  dingpanRuntime,
  fbaAlertRuntime,
  filesRuntime,
  groupManagementRuntime,
  knowledgeBaseRuntime,
  lobeAgentRuntime,
  pageAgentRuntime,
  verifyResultRuntime,
  lobeDeliveryCheckerRuntime,
  workbookRuntime,
]);

export const getServerRuntime = (
  identifier: string,
  context: ToolExecutionContext,
): any | Promise<any> => {
  const factory = serverRuntimeFactories.get(identifier);
  return factory?.(context);
};

export const hasServerRuntime = (identifier: string): boolean =>
  serverRuntimeFactories.has(identifier);

export const getServerRuntimeIdentifiers = (): string[] =>
  Array.from(serverRuntimeFactories.keys());
