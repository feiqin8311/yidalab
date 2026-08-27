import {
  type AgentState,
  type CallLLMPayload,
  extractDingpanUploadOutcomes,
  resolveContextBudgets,
} from '@lobechat/agent-runtime';
import {
  type ComposioServiceSummary,
  type CredSummary,
  excludeDisabledComposioServices,
  generateComposioServicesList,
  generateCredsList,
  resolveAvailableComposioServices,
} from '@lobechat/builtin-tool-creds';
import { builtinTools } from '@lobechat/builtin-tools';
import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import type {
  AgentBuilderContext,
  AgentContextDocument,
  AgentGroupConfig,
  OfficialToolItem,
  OnboardingContext,
} from '@lobechat/context-engine';
import { resolveTopicReferences } from '@lobechat/context-engine';
import type { ChatStreamPayload } from '@lobechat/model-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  buildContextEngineeringAttributes,
  CONTEXT_ENGINEERING_SPAN_NAME,
  tracer as agentRuntimeTracer,
} from '@lobechat/observability-otel/modules/agent-runtime';
import { getActivePluginIds, getDisabledPluginIds } from '@lobechat/types';

import { composioEnv } from '@/config/composio';
import { AgentModel } from '@/database/models/agent';
import { FileModel } from '@/database/models/file';
import { MessageModel as MessageModelClass } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { OnboardingService } from '@/server/services/onboarding';
import { listVaultCredSummaries } from '@/server/utils/withVaultCredEnv';
import {
  filterAgentContextDocumentsBySelection,
  toAgentContextDocuments,
} from '@/utils/agentDocumentContextMapping';

import type { RuntimeExecutorContext } from '../context';
import { buildPostProcessUrl, log, resolveRuntimeHistoryCount } from '../executorHelpers';
import { getOperationCached } from '../operationCache';
import {
  resolveServerCallLlmContextHints,
  type ServerCallLlmContextHints,
} from './serverCallLlmContextHints';
import type { ServerCallLlmTooling } from './serverCallLlmTooling';

interface BuildServerCallLlmContextInput {
  ctx: RuntimeExecutorContext;
  llmPayload: CallLLMPayload;
  model: string;
  provider: string;
  state: AgentState;
  tooling: ServerCallLlmTooling;
}

export interface ServerCallLlmContextBuildResult {
  preserveThinkingForPayload?: boolean;
  processedMessages: ChatStreamPayload['messages'];
  resolvedExtendParams?: ServerCallLlmContextHints['resolvedExtendParams'];
  shouldReplayAssistantReasoning: boolean;
}

export const buildServerCallLlmContext = async ({
  ctx,
  llmPayload,
  model,
  provider,
  state,
  tooling,
}: BuildServerCallLlmContextInput): Promise<ServerCallLlmContextBuildResult> => {
  const agentConfig = ctx.agentConfig;
  if (!agentConfig) {
    return {
      processedMessages: llmPayload.messages as ChatStreamPayload['messages'],
      shouldReplayAssistantReasoning: false,
    };
  }

  const { operationId, stepIndex } = ctx;
  const { resolved, resolvedSkills, toolDiscoveryConfig } = tooling;
  const contextHints = await resolveServerCallLlmContextHints({
    ctx,
    llmPayload,
    model,
    provider,
  });
  const {
    capabilities,
    contextWindowTokens,
    messagesForContext,
    modelDisplayName,
    modelKnowledgeCutoff,
    preserveThinkingForPayload,
    resolvedExtendParams,
    shouldReplayAssistantReasoning,
  } = contextHints;

  // Extract <refer_topic> tags from messages and fetch summaries.
  // Skip if messages already contain injected topic_reference_context
  // (e.g., from client-side contextEngineering preprocessing) to avoid double injection.
  const alreadyHasTopicRefs = (messagesForContext as Array<{ content: string | unknown }>).some(
    (message) =>
      typeof message.content === 'string' && message.content.includes('topic_reference_context'),
  );

  const topicReferencesPromise = (async () => {
    if (alreadyHasTopicRefs || !ctx.serverDB || !ctx.userId) return;
    const topicModel = new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
    const messageModel = new MessageModelClass(ctx.serverDB, ctx.userId, ctx.workspaceId);
    return resolveTopicReferences(
      messagesForContext as Array<{ content: string | unknown }>,
      async (topicId) => topicModel.findById(topicId),
      async (topicId) => {
        const topic = await topicModel.findById(topicId);
        return messageModel.query(
          {
            agentId: topic?.agentId ?? undefined,
            groupId: topic?.groupId ?? undefined,
            topicId,
          },
          { postProcessUrl: buildPostProcessUrl(ctx) },
        );
      },
    );
  })();

  // Fetch agent documents for context injection.
  const agentId = state.metadata?.agentId;
  let allPluginsPromise: ReturnType<PluginModel['query']> | undefined;
  const loadAllPlugins = () => {
    allPluginsPromise ??= new PluginModel(ctx.serverDB, ctx.userId!, ctx.workspaceId).query();
    return allPluginsPromise;
  };
  const agentDocumentsPromise = (async (): Promise<AgentContextDocument[] | undefined> => {
    if (!agentId || !ctx.serverDB || !ctx.userId) return;
    try {
      const agentDocService = new AgentDocumentsService(
        ctx.serverDB,
        ctx.userId,
        state.metadata?.workspaceId ?? ctx.workspaceId,
      );
      const docs = await agentDocService.getAgentContextDocuments(agentId);
      if (docs.length > 0) {
        return filterAgentContextDocumentsBySelection(
          toAgentContextDocuments(docs),
          agentConfig?.chatConfig?.enabledAgentDocumentIds,
        );
      }
    } catch (error) {
      log('Failed to resolve agent documents for agent %s: %O', agentId, error);
    }
  })();

  // Detect onboarding agent and build context injection.
  const isOnboardingAgent =
    agentConfig?.slug === 'web-onboarding' ||
    resolved.enabledToolIds.includes('lobe-web-onboarding');
  const alreadyHasOnboardingContext = (
    messagesForContext as Array<{ content: string | unknown }>
  ).some((message) => {
    if (typeof message.content !== 'string') return false;

    return (
      message.content.includes('<onboarding_context>') ||
      message.content.includes('<current_soul_document>') ||
      message.content.includes('<current_user_persona>')
    );
  });

  const onboardingContextPromise = (async (): Promise<OnboardingContext | undefined> => {
    if (!isOnboardingAgent || alreadyHasOnboardingContext || !ctx.serverDB || !ctx.userId) return;
    try {
      const { formatWebOnboardingStateMessage } =
        await import('@lobechat/builtin-tool-web-onboarding/utils');
      const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
      const docService = new AgentDocumentsService(
        ctx.serverDB,
        ctx.userId,
        state.metadata?.workspaceId ?? ctx.workspaceId,
      );
      const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);

      const [onboardingState, soulDoc, persona, userInfo] = await Promise.all([
        onboardingService.getState(),
        onboardingService
          .getInboxAgentId()
          .then((inboxAgentId) =>
            inboxAgentId ? docService.getDocumentByFilename(inboxAgentId, 'SOUL.md') : null,
          )
          .catch((error) => {
            log('Failed to fetch SOUL.md for onboarding context: %O', error);
            return null;
          }),
        personaModel.getLatestPersonaDocument().catch((error) => {
          log('Failed to fetch user persona for onboarding context: %O', error);
          return null;
        }),
        onboardingService.getInitialUserInfo().catch((error) => {
          log('Failed to fetch initial user info for onboarding context: %O', error);
          return undefined;
        }),
      ]);

      const onboardingContext = {
        discoveryUserMessageCount: onboardingState.discoveryUserMessageCount,
        personaContent: persona?.persona ?? null,
        phaseGuidance: formatWebOnboardingStateMessage(onboardingState),
        remainingDiscoveryExchanges: onboardingState.remainingDiscoveryExchanges,
        soulContent: soulDoc?.content ?? null,
        userInfo,
      };
      log('Built onboarding context for agent %s, phase: %s', agentId, onboardingState.phase);
      return onboardingContext;
    } catch (error) {
      log('Failed to build onboarding context: %O', error);
    }
  })();

  // Build additional placeholder variables for the lobehub builtin skill
  // (`packages/builtin-skills/src/lobehub/content.ts`) so it can render
  // `{{agent_id}}` / `{{agent_title}}` / `{{topic_id}}` etc. into the
  // model's prompt without needing a separate context injector.
  const lobehubSkillAgentId = state.metadata?.agentId;
  const lobehubSkillTopicId = state.metadata?.topicId;
  const lobehubSkillAgentMeta = state.metadata?.agentConfig as
    { description?: string | null; title?: string | null } | undefined;

  const lobehubSkillTopicTitlePromise = (async () => {
    if (!lobehubSkillTopicId || !ctx.serverDB || !ctx.userId) return '';
    try {
      const topicModelForLobehub = new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const topicRecord = await getOperationCached(ctx, `topic:${lobehubSkillTopicId}`, () =>
        topicModelForLobehub.findById(lobehubSkillTopicId),
      );
      return topicRecord?.title ?? '';
    } catch (error) {
      log('Failed to load topic title for lobehub skill placeholders: %O', error);
      return '';
    }
  })();

  // Tool-specific template variable resolution. The client-side
  // contextEngineering.ts resolves these via Zustand stores and lambdaClient.
  // In execAgent (server/bot) mode we must fetch from DB directly.
  const serverUserInfoPromise = (async () => {
    if (!ctx.serverDB || !ctx.userId) return { language: '', username: '' };
    try {
      const userInfo = await getOperationCached(ctx, 'user:generation-info', () =>
        UserModel.getInfoForAIGeneration(ctx.serverDB, ctx.userId!),
      );
      return { language: userInfo.responseLanguage, username: userInfo.userName };
    } catch (error) {
      log('Failed to fetch user info for {{username}}/{{language}} substitution: %O', error);
      return { language: '', username: '' };
    }
  })();

  const sandboxEnabled = String(resolved.enabledToolIds.includes('lobe-cloud-sandbox'));
  const sandboxUploadedFilesPromise = (async () => {
    if (sandboxEnabled !== 'true' || !ctx.serverDB || !ctx.userId || !lobehubSkillTopicId) {
      return '';
    }
    try {
      const { formatUploadedFilesPrompt } = await import('@lobechat/builtin-tool-cloud-sandbox');
      const fileModel = new FileModel(ctx.serverDB, ctx.userId);
      const uploadedFiles = await fileModel.findFilesToInitInSandbox(lobehubSkillTopicId);
      return formatUploadedFilesPrompt(uploadedFiles);
    } catch (error) {
      log('Failed to resolve files for {{sandbox_uploaded_files}} substitution: %O', error);
      return '';
    }
  })();

  const sessionDate = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: ctx.userTimezone || 'UTC',
    weekday: 'long',
    year: 'numeric',
  }).format(new Date());

  const memoryEffort = String(
    (state.metadata?.agentConfig as any)?.chatConfig?.memory?.effort ?? '',
  );

  const credsListPromise = (async () => {
    if (!ctx.userId) return '';
    try {
      // Settings → Credentials writes `localCreds` (user_credentials). Market
      // SDK is a different vault and is empty on this self-hosted path.
      const userCreds = await listVaultCredSummaries(ctx.userId, ctx.serverDB);
      const credsList = generateCredsList(
        userCreds.map(
          (cred): CredSummary => ({
            description: cred.description,
            key: cred.key,
            name: cred.name,
            ownerType: cred.scope === 'company' ? 'organization' : undefined,
            type: cred.type,
          }),
        ),
      );
      log('Fetched %d creds for {{CREDS_LIST}} substitution', userCreds.length);
      return credsList;
    } catch (error) {
      log('Failed to fetch creds for {{CREDS_LIST}} substitution: %O', error);
      return '';
    }
  })();

  const composioServicesListPromise = (async () => {
    if (!ctx.serverDB || !ctx.userId || !composioEnv.COMPOSIO_API_KEY) return '';
    try {
      const allPlugins = await loadAllPlugins();
      const validComposioIds = new Set(COMPOSIO_APP_TYPES.map((tool) => tool.identifier));
      const connectedIds = new Set(
        allPlugins
          .filter(
            (plugin) =>
              validComposioIds.has(plugin.identifier) &&
              (plugin.customParams as any)?.composio?.status === 'ACTIVE',
          )
          .map((plugin) => plugin.identifier),
      );
      // Disabled services are dropped from both lists — not surfaced as
      // "connected, use directly" nor as "available to connect".
      let disabledIdSet = new Set<string>();
      if (agentId) {
        const agentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
        const agentConfig = await agentModel.getAgentConfigById(agentId);
        disabledIdSet = new Set(getDisabledPluginIds(agentConfig?.plugins ?? undefined));
      }
      const connected: ComposioServiceSummary[] = excludeDisabledComposioServices(
        COMPOSIO_APP_TYPES.filter((tool) => connectedIds.has(tool.identifier)),
        disabledIdSet,
      ).map((tool) => ({ identifier: tool.identifier, name: tool.label }));
      const available = resolveAvailableComposioServices(
        COMPOSIO_APP_TYPES,
        connectedIds,
        disabledIdSet,
      );
      const composioServicesList = generateComposioServicesList(connected, available);
      log(
        'Fetched Composio services for {{COMPOSIO_SERVICES_LIST}}: connected=%d, available=%d',
        connected.length,
        available.length,
      );
      return composioServicesList;
    } catch (error) {
      log(
        'Failed to fetch Composio services for {{COMPOSIO_SERVICES_LIST}} substitution: %O',
        error,
      );
      return '';
    }
  })();

  const editingAgentId = state.metadata?.editingAgentId;
  const agentBuilderContextPromise = (async (): Promise<AgentBuilderContext | undefined> => {
    if (!editingAgentId || !ctx.serverDB || !ctx.userId) return;
    try {
      const editingAgentModel = new AgentModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
      const editingConfig = (await editingAgentModel.getAgentConfigById(editingAgentId)) as Record<
        string,
        any
      > | null;
      if (editingConfig) {
        const enabledPlugins: string[] = getActivePluginIds(
          Array.isArray(editingConfig.plugins) ? editingConfig.plugins : undefined,
        );
        const composioIdentifiers = new Set(COMPOSIO_APP_TYPES.map((tool) => tool.identifier));
        const officialTools: OfficialToolItem[] = [];

        for (const tool of builtinTools) {
          if (tool.hidden) continue;
          if (composioIdentifiers.has(tool.identifier)) continue;
          officialTools.push({
            description: tool.manifest?.meta?.description,
            enabled: enabledPlugins.includes(tool.identifier),
            identifier: tool.identifier,
            installed: true,
            name: tool.manifest?.meta?.title || tool.identifier,
            type: 'builtin',
          });
        }

        if (composioEnv.COMPOSIO_API_KEY) {
          try {
            const allPlugins = await loadAllPlugins();
            const connectedComposioIds = new Set(
              allPlugins
                .filter(
                  (plugin) =>
                    composioIdentifiers.has(plugin.identifier) &&
                    (plugin.customParams as any)?.composio?.status === 'ACTIVE',
                )
                .map((plugin) => plugin.identifier),
            );
            for (const tool of COMPOSIO_APP_TYPES) {
              officialTools.push({
                description: `LobeHub Mcp Server: ${tool.label}`,
                enabled: enabledPlugins.includes(tool.identifier),
                identifier: tool.identifier,
                installed: connectedComposioIds.has(tool.identifier),
                name: tool.label,
                type: 'composio',
              });
            }
          } catch (composioError) {
            log('Failed to load Composio status for agentBuilderContext: %O', composioError);
          }
        }

        return {
          config: {
            chatConfig: editingConfig.chatConfig ?? undefined,
            model: editingConfig.model ?? undefined,
            openingMessage: editingConfig.openingMessage ?? undefined,
            openingQuestions: editingConfig.openingQuestions ?? undefined,
            params: editingConfig.params ?? undefined,
            plugins: enabledPlugins,
            provider: editingConfig.provider ?? undefined,
            systemRole: editingConfig.systemRole ?? undefined,
          },
          meta: {
            avatar: editingConfig.avatar ?? undefined,
            backgroundColor: editingConfig.backgroundColor ?? undefined,
            description: editingConfig.description ?? undefined,
            tags: editingConfig.tags ?? undefined,
            title: editingConfig.title ?? undefined,
          },
          ...(officialTools.length > 0 && { officialTools }),
        };
      }
    } catch (error) {
      log('Failed to build agentBuilderContext for editing agent %s: %O', editingAgentId, error);
    }
  })();

  const [
    topicReferences,
    agentDocuments,
    onboardingContext,
    lobehubSkillTopicTitle,
    serverUserInfo,
    sandboxUploadedFiles,
    credsListStr,
    composioServicesListStr,
    agentBuilderContext,
  ] = await Promise.all([
    topicReferencesPromise,
    agentDocumentsPromise,
    onboardingContextPromise,
    lobehubSkillTopicTitlePromise,
    serverUserInfoPromise,
    sandboxUploadedFilesPromise,
    credsListPromise,
    composioServicesListPromise,
    agentBuilderContextPromise,
  ]);
  const lobehubSkillVariables: Record<string, string> = {
    agent_description: lobehubSkillAgentMeta?.description ?? '',
    agent_id: lobehubSkillAgentId ?? '',
    agent_title: lobehubSkillAgentMeta?.title ?? '',
    topic_id: lobehubSkillTopicId ?? '',
    topic_title: lobehubSkillTopicTitle,
  };
  const serverLanguage = serverUserInfo.language;
  const serverUsername = serverUserInfo.username;

  const contextEngineInput = {
    agentDocuments,
    ...(agentBuilderContext && { agentBuilderContext }),
    agentGroup: state.metadata?.agentGroup as AgentGroupConfig | undefined,
    agentManagementContext: (state as any).initialContext?.initialContext?.mentionedAgents?.length
      ? {
          mentionedAgents: (state as any).initialContext.initialContext.mentionedAgents,
        }
      : undefined,
    additionalVariables: {
      ...state.metadata?.deviceSystemInfo,
      ...lobehubSkillVariables,
      COMPOSIO_SERVICES_LIST: composioServicesListStr,
      CREDS_LIST: credsListStr,
      language: serverLanguage,
      memory_effort: memoryEffort,
      sandbox_enabled: sandboxEnabled,
      sandbox_uploaded_files: sandboxUploadedFiles,
      session_date: sessionDate,
      username: serverUsername,
    },
    userTimezone: ctx.userTimezone,
    capabilities,
    botPlatformContext: ctx.botPlatformContext,
    discordContext: ctx.discordContext,
    enableHistoryCount: agentConfig.chatConfig?.enableHistoryCount ?? undefined,
    maxHistoryTokens: (() => {
      const budgets = state.metadata?.contextPolicy?.budgets as
        { maxHistoryTokens?: number } | undefined;
      if (budgets?.maxHistoryTokens) return budgets.maxHistoryTokens;
      if (state.metadata?.contextPolicy) {
        const window = contextWindowTokens as number | undefined;
        if (window && window > 0) return Math.min(64_000, Math.floor(window * 0.35));
        return 64_000;
      }
      return undefined;
    })(),
    toolResultPrune: (() => {
      if (!state.metadata?.contextPolicy) return undefined;
      const budgets = resolveContextBudgets(state.metadata.contextPolicy);
      return {
        enabled: true,
        maxHistoricalToolTokens: budgets.maxHistoricalToolTokens,
        maxToolResultTokens: budgets.maxToolResultTokens,
        maxToolRoundTokens: budgets.maxToolRoundTokens,
      };
    })(),
    evalContext: ctx.evalContext,
    forceFinish: state.forceFinish,
    // Align with resolveServerCallLlmTooling: bot/dingpan + no successful upload yet
    forceFinishDeliveryOnly: (() => {
      if (!state.forceFinish) return false;
      const wantsDingpan =
        !!(state.metadata?.botContext || state.metadata?.bot) ||
        state.metadata?.htmlDeliveryMode === 'dingpan' ||
        state.metadata?.chatConfig?.htmlDeliveryMode === 'dingpan' ||
        state.metadata?.agentConfig?.chatConfig?.htmlDeliveryMode === 'dingpan';
      if (!wantsDingpan) return false;
      const outcomes = extractDingpanUploadOutcomes(
        (state.messages ?? []).map((message: any) => ({
          content: message?.content,
          plugin: message?.plugin,
          role: message?.role,
        })),
      );
      return !outcomes.some((o) => o.success && o.previewUrl);
    })(),
    forceFinishReason:
      typeof state.metadata?.runBrakeReason === 'string'
        ? state.metadata.runBrakeReason
        : undefined,
    historyCount: resolveRuntimeHistoryCount(agentConfig.chatConfig?.historyCount),
    initialContext: (state as any).initialContext?.initialContext,
    knowledge: {
      fileContents: agentConfig.files
        ?.filter((file: { enabled?: boolean | null }) => file.enabled === true)
        .map((file: { content?: string | null; id?: string; name?: string }) => ({
          content: file.content ?? '',
          fileId: file.id ?? '',
          filename: file.name ?? '',
        })),
      knowledgeBases: agentConfig.knowledgeBases
        ?.filter((knowledgeBase: { enabled?: boolean | null }) => knowledgeBase.enabled === true)
        .map((knowledgeBase: { id?: string; name?: string }) => ({
          id: knowledgeBase.id ?? '',
          name: knowledgeBase.name ?? '',
        })),
    },
    messages: messagesForContext,
    model,
    modelDisplayName,
    modelKnowledgeCutoff,
    contextWindowTokens,
    provider,
    systemRole: agentConfig.systemRole ?? undefined,
    toolDiscoveryConfig,
    toolsConfig: {
      manifests: Object.values(resolved.promptManifestMap),
      tools: resolved.enabledToolIds,
    },
    userMemory: state.metadata?.userMemory,
    ...(resolvedSkills?.enabledSkills?.length && {
      skillsConfig: { enabledSkills: resolvedSkills.enabledSkills },
    }),
    enableAgentMode: agentConfig.chatConfig?.enableAgentMode,
    ...(topicReferences && { topicReferences }),
    ...(onboardingContext && { onboardingContext }),
  };

  // Shadow / OTEL: pre-process estimate includes messages + tools schema + system + skills
  // (these are the main fixed costs in the original high-token traces).
  const preTokenEstimate = (() => {
    try {
      const msgText = (messagesForContext as Array<{ content?: unknown; tools?: unknown }>)
        .map((m) => {
          const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
          const t = Array.isArray(m.tools) ? JSON.stringify(m.tools) : '';
          return c + t;
        })
        .join('\n');
      const toolsSchema = JSON.stringify(resolved.promptManifestMap ?? {});
      const system = agentConfig.systemRole ?? '';
      const skills = JSON.stringify(resolvedSkills?.enabledSkills ?? []);
      return Math.ceil((msgText.length + toolsSchema.length + system.length + skills.length) / 4);
    } catch {
      return undefined;
    }
  })();
  const windowRatio =
    preTokenEstimate && contextWindowTokens
      ? Math.round((preTokenEstimate / contextWindowTokens) * 1000) / 1000
      : undefined;

  const processedMessages = await agentRuntimeTracer.startActiveSpan(
    CONTEXT_ENGINEERING_SPAN_NAME,
    {
      attributes: buildContextEngineeringAttributes({
        hasImages: (messagesForContext as Array<{ content?: unknown }>).some(
          (message) =>
            Array.isArray(message.content) &&
            (message.content as Array<{ type?: string }>).some(
              (part) => part?.type === 'image_url',
            ),
        ),
        historyCompressed:
          Array.isArray(messagesForContext) &&
          messagesForContext.some(
            (message: { role?: string }) => message?.role === 'compressedGroup',
          ),
        knowledgeCount:
          (contextEngineInput.knowledge?.knowledgeBases?.length ?? 0) +
          (contextEngineInput.knowledge?.fileContents?.length ?? 0),
        knowledgeInjected:
          (contextEngineInput.knowledge?.knowledgeBases?.length ?? 0) > 0 ||
          (contextEngineInput.knowledge?.fileContents?.length ?? 0) > 0,
        memoryInjected: Boolean(contextEngineInput.userMemory?.memories),
        messageCount: messagesForContext.length,
        operationId,
        stepIndex,
        systemRoleLength: contextEngineInput.systemRole?.length,
        tokenUsage: preTokenEstimate,
        toolCount: contextEngineInput.toolsConfig?.tools?.length ?? 0,
        windowRatio,
      }),
    },
    async (ceSpan) => {
      try {
        const result = await serverMessagesEngine(contextEngineInput);
        ceSpan.setAttribute('lobehub.context.message_count', result.length);
        // Post-process token shadow (after prune / truncate)
        try {
          const postText = result
            .map((m: any) =>
              typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
            )
            .join('\n');
          const postTokens = Math.ceil(postText.length / 4);
          ceSpan.setAttribute('lobehub.context.token_usage_post', postTokens);
          if (preTokenEstimate != null) {
            ceSpan.setAttribute(
              'lobehub.context.tokens_pruned_est',
              Math.max(0, preTokenEstimate - postTokens),
            );
          }
        } catch {
          // ignore shadow metric failures
        }
        return result;
      } catch (error) {
        ceSpan.recordException(error as Error);
        ceSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        ceSpan.end();
      }
    },
  );

  const {
    messages: _inputMsgs,
    toolsConfig: _toolsConfig,
    ...contextEngineInputLite
  } = contextEngineInput;
  ctx.tracingContextEngine?.(
    { ...contextEngineInputLite, toolCount: _toolsConfig?.tools?.length ?? 0 },
    processedMessages,
  );

  return {
    preserveThinkingForPayload,
    processedMessages,
    resolvedExtendParams,
    shouldReplayAssistantReasoning,
  };
};
