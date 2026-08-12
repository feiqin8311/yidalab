/**
 * YidaLab internal lambda router — core product surface only.
 * Aliased over `./index.ts` when YIDALAB_BUILD_PROFILE=internal.
 *
 * Dropped: full market (except creds), composio, klavis, comfyui, video/image
 * generation, agentEval, commercial SaaS (subscription/topUp/referral/...), notebook.
 * Keep: device (chat device switcher), workspace/company/task/dingpan/memory/agent/chat/file.
 */
import { taskTemplateRouter } from '@/business/server/lambda-routers/taskTemplate';
import { workspaceRouter } from '@/business/server/lambda-routers/workspace';
import { workspaceAuditLogRouter } from '@/business/server/lambda-routers/workspaceAuditLog';
import { workspaceCreditsRouter } from '@/business/server/lambda-routers/workspaceCredits';
import { workspaceCredsRouter } from '@/business/server/lambda-routers/workspaceCreds';
import { workspaceDataRouter } from '@/business/server/lambda-routers/workspaceData';
import { workspaceMemberRouter } from '@/business/server/lambda-routers/workspaceMember';
import { workspaceUsageRouter } from '@/business/server/lambda-routers/workspaceUsage';
import { publicProcedure, router } from '@/libs/trpc/lambda';

import { agentRouter } from './agent';
import { agentBotProviderRouter } from './agentBotProvider';
import { agentDocumentRouter } from './agentDocument';
import { agentGroupRouter } from './agentGroup';
import { agentNotifyRouter } from './agentNotify';
import { agentSkillsRouter } from './agentSkills';
import { aiAgentRouter } from './aiAgent';
import { aiChatRouter } from './aiChat';
import { aiModelRouter } from './aiModel';
import { aiProviderRouter } from './aiProvider';
import { apiKeyRouter } from './apiKey';
import { asrRouter } from './asr';
import { botMessageRouter } from './botMessage';
import { briefRouter } from './brief';
import { businessFunctionRouter } from './businessFunction';
import { changelogRouter } from './changelog';
import { chunkRouter } from './chunk';
import { companyRouter } from './company';
import { companyFeedbackRouter } from './companyFeedback';
import { configRouter } from './config';
import { connectorRouter } from './connector';
import { deviceRouter } from './device';
import { dingpanRouter } from './dingpan';
import { documentRouter } from './document';
import { exporterRouter } from './exporter';
import { fileRouter } from './file';
import { filesRouter } from './files';
import { followUpActionRouter } from './followUpAction';
import { homeRouter } from './home';
import { importerRouter } from './importer';
import { knowledgeRouter } from './knowledge';
import { knowledgeBaseRouter } from './knowledgeBase';
import { llmGenerationTracingRouter } from './llmGenerationTracing';
import { localCredsRouter } from './localCreds';
import { marketRouter } from './market';
import { messageRouter } from './message';
import { messengerRouter } from './messenger';
import { notificationRouter } from './notification';
import { oauthDeviceFlowRouter } from './oauthDeviceFlow';
import { pluginRouter } from './plugin';
import { recentRouter } from './recent';
import { searchRouter } from './search';
import { sessionRouter } from './session';
import { sessionGroupRouter } from './sessionGroup';
import { shareRouter } from './share';
import { taskRouter } from './task';
import { threadRouter } from './thread';
import { topicRouter } from './topic';
import { uploadRouter } from './upload';
import { usageRouter } from './usage';
import { userRouter } from './user';
import { userMemoriesRouter } from './userMemories';
import { userMemoryRouter } from './userMemory';
import { verifyRouter } from './verify';
import { webBrowsingRouter } from './webBrowsing';
import { workbookRouter } from './workbook';
import { workspaceUserSettingsRouter } from './workspaceUserSettings';

export const lambdaRouter = router({
  agent: agentRouter,
  agentBotProvider: agentBotProviderRouter,
  agentNotify: agentNotifyRouter,
  botMessage: botMessageRouter,
  agentDocument: agentDocumentRouter,
  agentSkills: agentSkillsRouter,
  device: deviceRouter,
  task: taskRouter,
  changelog: changelogRouter,
  brief: briefRouter,
  aiAgent: aiAgentRouter,
  aiChat: aiChatRouter,
  aiModel: aiModelRouter,
  aiProvider: aiProviderRouter,
  apiKey: apiKeyRouter,
  asr: asrRouter,
  chunk: chunkRouter,
  businessFunction: businessFunctionRouter,
  company: companyRouter,
  companyFeedback: companyFeedbackRouter,
  config: configRouter,
  connector: connectorRouter,
  dingpan: dingpanRouter,
  document: documentRouter,
  files: filesRouter,
  workbook: workbookRouter,
  exporter: exporterRouter,
  file: fileRouter,
  followUpAction: followUpActionRouter,
  group: agentGroupRouter,
  healthcheck: publicProcedure.query(() => "i'm live!"),
  home: homeRouter,
  importer: importerRouter,
  knowledge: knowledgeRouter,
  knowledgeBase: knowledgeBaseRouter,
  localCreds: localCredsRouter,
  llmGenerationTracing: llmGenerationTracingRouter,
  market: marketRouter,
  message: messageRouter,
  messenger: messengerRouter,
  notification: notificationRouter,
  oauthDeviceFlow: oauthDeviceFlowRouter,
  plugin: pluginRouter,
  recent: recentRouter,
  search: searchRouter,
  session: sessionRouter,
  sessionGroup: sessionGroupRouter,
  share: shareRouter,
  thread: threadRouter,
  topic: topicRouter,
  upload: uploadRouter,
  usage: usageRouter,
  user: userRouter,
  userMemories: userMemoriesRouter,
  userMemory: userMemoryRouter,
  verify: verifyRouter,
  webBrowsing: webBrowsingRouter,
  workspace: workspaceRouter,
  workspaceAuditLog: workspaceAuditLogRouter,
  workspaceCreds: workspaceCredsRouter,
  workspaceCredits: workspaceCreditsRouter,
  workspaceData: workspaceDataRouter,
  workspaceMember: workspaceMemberRouter,
  workspaceUsage: workspaceUsageRouter,
  workspaceUserSettings: workspaceUserSettingsRouter,
  taskTemplate: taskTemplateRouter,
});

export type LambdaRouter = typeof lambdaRouter;
