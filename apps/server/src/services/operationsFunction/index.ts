import type { LobeChatDatabase } from '@lobechat/database';
import { RequestTrigger } from '@lobechat/types';
import {
  CAPABILITY_PLUGIN_CANDIDATES,
  type CapabilityAvailabilityMap,
  evaluateOperationsPreflight,
  extractOpsHtmlArtifact,
  getOperationsFunction,
  getOperationsMode,
  MCP_CAPABILITY_IDS,
  OPERATIONS_FUNCTIONS,
  type OperationsCapabilityId,
  type OperationsModeDef,
  SKILL_CAPABILITY_IDS,
} from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { AiModelModel } from '@/database/models/aiModel';
import { BusinessFunctionRunModel } from '@/database/models/businessFunction';
import { CompanyMarketMcpModel } from '@/database/models/companyMarketMcp';
import { MessageModel } from '@/database/models/message';
import type {
  BusinessFunctionOperationsConfig,
  BusinessFunctionOperationsResultMeta,
} from '@/database/schemas';
import { AgentRuntimeService } from '@/server/services/agentRuntime/AgentRuntimeService';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('lobe-server:operations-function');

const FUNCTION_TYPE_PREFIX = 'ops:';

const OP_RUNNING = new Set(['idle', 'running', 'waiting_for_human', 'waiting_for_async_tool']);
const OP_SUCCESS = new Set(['done']);
const OP_FAILED = new Set(['error', 'interrupted']);

export type OpsCreateRunInput = {
  functionId: string;
  modeId: string;
  model: { model: string; provider: string };
  params: Record<string, unknown>;
  rerunFromId?: string;
  workspaceId: string;
};

type ResolvedCap = {
  available: boolean;
  capabilityId: OperationsCapabilityId;
  reason?: string;
  resolvedPluginIds: string[];
};

/**
 * Fixed operations analysis platform: catalog, preflight, run lifecycle.
 * Isolated from chat via RequestTrigger.BusinessFunction topics.
 */
export class OperationsFunctionService {
  private runModel: BusinessFunctionRunModel;
  /** capabilityId → resolved plugin ids that are actually available */
  private resolvedPlugins = new Map<OperationsCapabilityId, string[]>();

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId: string,
  ) {
    this.runModel = new BusinessFunctionRunModel(db, userId, workspaceId);
  }

  private functionType = (functionId: string) => `${FUNCTION_TYPE_PREFIX}${functionId}`;

  getCatalog = async (opts?: {
    functionId?: string;
    modeId?: string;
    modelSupportsTools?: boolean;
    modelSupportsVision?: boolean;
  }) => {
    const availability = await this.resolveAvailability({
      modelSupportsTools: opts?.modelSupportsTools ?? true,
      modelSupportsVision: opts?.modelSupportsVision ?? false,
    });

    const functions = OPERATIONS_FUNCTIONS.filter((f) =>
      opts?.functionId ? f.id === opts.functionId : true,
    ).map((fn) => ({
      description: fn.description,
      id: fn.id,
      name: fn.name,
      path: fn.path,
      modes: fn.modes
        .filter((m) => (opts?.modeId ? m.id === opts.modeId : true))
        .map((m) => this.serializeMode(m, availability)),
    }));

    return { functions, availability };
  };

  private serializeMode = (mode: OperationsModeDef, availability: CapabilityAvailabilityMap) => {
    const preflight = evaluateOperationsPreflight(mode, availability);
    return {
      capabilities: mode.capabilities,
      description: mode.description,
      fields: mode.fields,
      functionId: mode.functionId,
      id: mode.id,
      maxSteps: mode.maxSteps,
      name: mode.name,
      preflight,
      promptVersion: mode.promptVersion,
      reportSections: mode.reportSections,
      requiresTools: mode.requiresTools,
      requiresVision: mode.requiresVision ?? false,
    };
  };

  /**
   * Resolve each capability against the caller's installed skills + workspace MCP.
   * Market catalog alone is NOT enough.
   */
  resolveCapability = async (capabilityId: OperationsCapabilityId): Promise<ResolvedCap> => {
    if (capabilityId === 'model.tools' || capabilityId === 'model.vision') {
      return {
        available: false,
        capabilityId,
        reason: 'model_checked_separately',
        resolvedPluginIds: [],
      };
    }

    const candidates = CAPABILITY_PLUGIN_CANDIDATES[capabilityId] ?? [];
    const skillModel = new AgentSkillModel(this.db, this.userId, this.workspaceId);
    const mcpModel = new CompanyMarketMcpModel(this.db, this.workspaceId);

    const resolved: string[] = [];

    if (capabilityId.startsWith('company.mcp.')) {
      for (const id of candidates) {
        const row = await mcpModel.findByIdentifier(id);
        if (row?.connection) resolved.push(row.identifier || id);
      }
      return {
        available: resolved.length > 0,
        capabilityId,
        reason: resolved.length ? undefined : 'not_installed',
        resolvedPluginIds: resolved,
      };
    }

    // Skills + data tools: user-scoped AgentSkill install
    for (const id of candidates) {
      const row =
        (await skillModel.findByIdentifier(id)) ||
        (await skillModel.findByName(id.replace(/^skill\./, '')));
      if (row) resolved.push(row.identifier || id);
    }

    // Builtin web browsing is always present as a platform tool when listed
    if (capabilityId === 'web.search' && resolved.length === 0) {
      // lobe-web-browsing is a builtin tool id, not a market skill — treat as available
      resolved.push('lobe-web-browsing');
    }

    return {
      available: resolved.length > 0,
      capabilityId,
      reason: resolved.length ? undefined : 'not_installed',
      resolvedPluginIds: resolved,
    };
  };

  resolveAvailability = async (opts: {
    modelSupportsTools: boolean;
    modelSupportsVision: boolean;
  }): Promise<CapabilityAvailabilityMap> => {
    this.resolvedPlugins.clear();
    const map: CapabilityAvailabilityMap = {
      'model.tools': opts.modelSupportsTools,
      'model.vision': opts.modelSupportsVision,
    };

    const ids: OperationsCapabilityId[] = [
      ...MCP_CAPABILITY_IDS,
      ...SKILL_CAPABILITY_IDS,
      'amazon.product',
      'amazon.reviews',
      'web.search',
    ];

    await Promise.all(
      ids.map(async (id) => {
        const resolved = await this.resolveCapability(id);
        map[id] = resolved.available;
        if (resolved.available) this.resolvedPlugins.set(id, resolved.resolvedPluginIds);
      }),
    );

    return map;
  };

  private assertModel = async (
    provider: string,
    modelId: string,
    mode: OperationsModeDef,
  ): Promise<{ tools: boolean; vision: boolean }> => {
    // Exact provider + model in current workspace only (no cross-provider fallback).
    const aiModel = new AiModelModel(this.db, this.userId, this.workspaceId);
    const row = await aiModel.findByIdAndProvider(modelId, provider);

    let abilities: { functionCall?: boolean; vision?: boolean } | undefined;

    if (row) {
      if (row.enabled === false) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'OPS_MODEL_DISABLED' });
      }
      abilities = (row.abilities || {}) as { functionCall?: boolean; vision?: boolean };
    } else {
      // Built-in registry: exact providerId + id only.
      const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');
      const bank = LOBE_DEFAULT_MODEL_LIST.find(
        (m) => m.id === modelId && m.providerId === provider,
      );
      if (!bank) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'OPS_MODEL_NOT_FOUND' });
      }
      abilities = (bank.abilities || {}) as { functionCall?: boolean; vision?: boolean };
    }

    const tools = abilities.functionCall === true;
    const vision = abilities.vision === true;

    if (mode.requiresTools && !tools) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'OPS_MODEL_NO_TOOLS' });
    }
    if (mode.requiresVision && !vision) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'OPS_MODEL_NO_VISION' });
    }

    return { tools, vision };
  };

  createRun = async (input: OpsCreateRunInput) => {
    const fn = getOperationsFunction(input.functionId);
    if (!fn) throw new TRPCError({ code: 'NOT_FOUND', message: 'OPS_FUNCTION_NOT_FOUND' });

    const mode = getOperationsMode(input.modeId);
    if (!mode || mode.functionId !== input.functionId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'OPS_MODE_NOT_FOUND' });
    }

    // Normalize empty strings before Zod (advanced optional numbers etc.)
    const cleanedParams = Object.fromEntries(
      Object.entries(input.params ?? {}).map(([k, v]) => [k, v === '' ? undefined : v]),
    );

    const parsed = mode.inputSchema.safeParse(cleanedParams);
    if (!parsed.success) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'OPS_PARAMS_INVALID',
        cause: parsed.error.flatten(),
      });
    }

    const provider = input.model.provider?.trim();
    const modelId = input.model.model?.trim();
    if (!provider || !modelId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'OPS_MODEL_REQUIRED' });
    }

    const modelCaps = await this.assertModel(provider, modelId, mode);

    const availability = await this.resolveAvailability({
      modelSupportsTools: modelCaps.tools,
      modelSupportsVision: modelCaps.vision,
    });
    const preflight = evaluateOperationsPreflight(mode, availability);
    if (!preflight.canRun) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'OPS_CAPABILITY_MISSING',
        cause: {
          missingRequired: preflight.missingRequired,
          statuses: preflight.statuses,
        },
      });
    }

    const config: BusinessFunctionOperationsConfig = {
      kind: 'operations',
      functionId: input.functionId,
      modeId: input.modeId,
      params: parsed.data,
      model: { provider, model: modelId },
      promptVersion: mode.promptVersion,
      capabilitiesSnapshot: {
        available: preflight.statuses.filter((s) => s.available).map((s) => s.id),
        degraded: preflight.degraded,
        missingRequired: [],
      },
      rerunFromId: input.rerunFromId,
    };

    const run = await this.runModel.create({
      functionType: this.functionType(input.functionId),
      status: 'queued',
      stage: 'queued',
      config: config as any,
      mainAsin:
        typeof parsed.data.asin === 'string'
          ? parsed.data.asin
          : typeof parsed.data.competitorAsin === 'string'
            ? parsed.data.competitorAsin
            : null,
      progress: { stage: 'queued', percent: 0, message: 'queued' },
    });

    try {
      await this.dispatch(run.id, mode, config, preflight);
    } catch (e) {
      // CAS: only claim failure while still queued. Succeeded onComplete must win.
      const cas = await this.runModel.updateIfStatus(run.id, ['queued'], {
        status: 'failed',
        stage: 'dispatch',
        finishedAt: new Date(),
        error: {
          code: 'OPS_DISPATCH_FAILED',
          message: e instanceof Error ? e.message : String(e),
          stage: 'dispatch',
          retryable: true,
        },
      } as any);
      if (cas) {
        // We wrote the failure — surface as dispatch error.
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'OPS_DISPATCH_FAILED',
          cause: e,
        });
      }
      // Another path already advanced the row (e.g. fast onComplete → succeeded).
      log('dispatch failed after non-queued state runId=%s; preserving: %O', run.id, e);
      const current = await this.runModel.findById(run.id);
      if (current) return current;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'OPS_DISPATCH_FAILED',
        cause: e,
      });
    }

    return this.runModel.findById(run.id);
  };

  /** Only plugins that are available for this mode (required + satisfied anyOf + optional present). */
  private pluginIdsForMode = (
    mode: OperationsModeDef,
    availability: CapabilityAvailabilityMap,
  ): string[] => {
    const { required = [], anyOfGroups = [], optional = [] } = mode.capabilities;
    const ids = new Set<OperationsCapabilityId>();

    for (const id of required) {
      if (availability[id]) ids.add(id);
    }

    // Pick first fully-available anyOf group only
    for (const group of anyOfGroups) {
      if (group.every((id) => availability[id])) {
        for (const id of group) ids.add(id);
        break;
      }
    }

    for (const id of optional) {
      if (availability[id]) ids.add(id);
    }

    const plugins = new Set<string>();
    for (const id of ids) {
      const resolved = this.resolvedPlugins.get(id) ?? CAPABILITY_PLUGIN_CANDIDATES[id] ?? [];
      for (const p of resolved) plugins.add(p);
    }
    return [...plugins];
  };

  private dispatch = async (
    runId: string,
    mode: OperationsModeDef,
    config: BusinessFunctionOperationsConfig,
    preflight: ReturnType<typeof evaluateOperationsPreflight>,
  ) => {
    const availability: CapabilityAvailabilityMap = Object.fromEntries(
      preflight.statuses.map((s) => [s.id, s.available]),
    );
    // model flags already in preflight via createRun path
    availability['model.tools'] = true;
    if (mode.requiresVision) availability['model.vision'] = true;

    const basePrompt = mode.buildPrompt(config.params);
    const pluginIds = this.pluginIdsForMode(mode, availability);
    const ai = new AiAgentService(this.db, this.userId, { workspaceId: this.workspaceId });

    const { buildOpsContextPolicy } = await import('./buildOpsContextPolicy');
    const { resolveManifestApisForPlugins } = await import('./resolveManifestApis');
    const manifestApis = await resolveManifestApisForPlugins(this.db, this.workspaceId, pluginIds);
    const contextPolicy = buildOpsContextPolicy({ mode, pluginIds, manifestApis });

    // traffic-single-asin: deterministic evidence prefetch → one report LLM pass
    let prompt = basePrompt;
    let maxSteps = mode.maxSteps;
    const instructions = [
      '你正在执行功能中心的固定运营分析任务。',
      '只使用本次已开放的工具；不要索要权限；不要闲聊。',
      '不要调用 activator 或安装新工具；必需能力已预加载。',
      '最终必须输出一个完整的 <lobeArtifact type="text/html"> HTML 报告。',
    ];

    // Only modes with an explicit ordered toolApis DAG get deterministic prefetch.
    // No regex tool guessing — missing allow-list falls through to agent tools.
    if (mode.toolApis?.length) {
      try {
        const { buildEvidenceDossier } = await import('./buildEvidenceDossier');
        const dossier = await buildEvidenceDossier({
          db: this.db,
          params: config.params,
          pluginIds,
          toolApis: mode.toolApis,
          workspaceId: this.workspaceId,
        });
        if (dossier?.text) {
          prompt = [
            basePrompt,
            '',
            '---',
            '以下为服务端确定性预取的 Evidence Dossier（已裁剪）。',
            '请优先基于该 dossier 撰写报告；仅在关键数字缺失时再调用工具补全。',
            '禁止重复拉取已在 dossier 中出现的相同参数只读查询。',
            '',
            dossier.text,
          ].join('\n');
          // Prefer a short report-generation loop once evidence is prefetched
          maxSteps = Math.min(mode.maxSteps, 6);
          instructions.push(
            `Evidence dossier 已注入（≈${dossier.tokens} tokens, ${dossier.toolCalls} tool calls）。优先用它写报告。`,
          );
          log(
            'ops dossier ready mode=%s tokens≈%d tools=%d',
            mode.id,
            dossier.tokens,
            dossier.toolCalls,
          );
        }
      } catch (e) {
        log('evidence dossier failed, falling back to agent tools: %O', e);
      }
    }

    const result = await ai.execAgent({
      slug: 'inbox',
      // Replace-scope: only mode plugins — do not inherit inbox Memory/Skill Store/Web noise
      // beyond what capabilities resolved. disableLocalSystem keeps sandbox off.
      additionalPluginIds: pluginIds,
      contextPolicy,
      disableLocalSystem: true,
      model: config.model.model,
      provider: config.model.provider,
      maxSteps,
      prompt,
      title: `[运营分析] ${mode.name}`,
      trigger: RequestTrigger.BusinessFunction,
      userInterventionConfig: { approvalMode: 'headless' },
      instructions: instructions.join('\n'),
      hooks: [
        {
          handler: async (event) => {
            const service = new OperationsFunctionService(this.db, this.userId, this.workspaceId);
            await service.completeFromOperation({
              errorMessage: event.errorMessage,
              lastAssistantContent: event.lastAssistantContent,
              operationId: event.operationId,
              reason: event.reason || 'done',
              runId,
              force: true,
            });
          },
          id: 'ops-run-complete',
          type: 'onComplete' as const,
          webhook: {
            body: { runId, userId: this.userId, workspaceId: this.workspaceId },
            delivery: 'qstash' as const,
            url: '/api/workflows/operations-function/on-complete',
          },
        },
      ],
    });

    // CAS: only queued → running; never clobber terminal
    const promoted = await this.runModel.updateIfStatus(runId, ['queued'], {
      status: 'running',
      stage: 'running',
      startedAt: new Date(),
      agentId: result.agentId,
      topicId: result.topicId,
      operationId: result.operationId,
      assistantMessageId: result.assistantMessageId,
      progress: { stage: 'running', percent: 10, message: 'running' },
    } as any);

    const current = await this.runModel.findById(runId);
    if (!promoted) {
      // Run deleted after cancel, or canceled/terminal — still interrupt the new op.
      const shouldInterrupt =
        !!result.operationId &&
        (!current || current.status === 'canceled' || Number(current.cancelRequested) === 1);

      if (current && !current.operationId) {
        // Attach op ids onto existing row without flipping status
        await this.runModel.updateIfStatus(runId, [current.status], {
          agentId: result.agentId,
          topicId: result.topicId,
          operationId: result.operationId,
          assistantMessageId: result.assistantMessageId,
        } as any);
      }

      if (shouldInterrupt && result.operationId) {
        try {
          const runtime = new AgentRuntimeService(this.db, this.userId, {
            workspaceId: this.workspaceId,
          });
          await runtime.interruptOperation(result.operationId);
        } catch (e) {
          log(
            'dispatch: interrupt after cancel/delete race op=%s runMissing=%s: %O',
            result.operationId,
            !current,
            e,
          );
        }
      }
    }
  };

  /**
   * Idempotent completion. When `force` is false (poll/reconcile), only finalize
   * if agent_operations is in a terminal status.
   */
  completeFromOperation = async (params: {
    errorMessage?: string;
    force?: boolean;
    lastAssistantContent?: string;
    operationId?: string;
    reason?: string;
    runId: string;
  }) => {
    const run = await this.runModel.findByIdUnscoped(params.runId);
    if (!run) return { ok: false as const, reason: 'not_found' };
    if (run.status === 'succeeded' || run.status === 'canceled') {
      return { ok: true as const, reason: 'already_terminal' };
    }

    if (run.userId !== this.userId || run.workspaceId !== this.workspaceId) {
      return { ok: false as const, reason: 'mismatch' };
    }

    if (Number(run.cancelRequested) === 1) {
      await this.runModel.updateById(params.runId, {
        status: 'canceled',
        stage: 'canceled',
        finishedAt: new Date(),
        progress: { stage: 'canceled', percent: 100, message: 'canceled' },
      } as any);
      return { ok: true as const, reason: 'canceled' };
    }

    const opId = params.operationId ?? run.operationId ?? undefined;

    // Gate: poll path must not finalize while operation still running
    if (!params.force && opId) {
      try {
        const opModel = new AgentOperationModel(this.db, this.userId, this.workspaceId);
        const op = await opModel.findById(opId);
        if (op) {
          if (OP_RUNNING.has(op.status)) {
            return { ok: true as const, reason: 'still_running' };
          }
          if (OP_FAILED.has(op.status) && !params.errorMessage) {
            params.errorMessage = op.completionReason || op.status;
            params.reason = 'error';
          }
          if (OP_SUCCESS.has(op.status) && !params.reason) {
            params.reason = op.completionReason || 'done';
          }
        } else if (!params.force) {
          // No op row yet — keep running
          return { ok: true as const, reason: 'op_missing' };
        }
      } catch (e) {
        log('completeFromOperation: op status read failed: %O', e);
        if (!params.force) return { ok: true as const, reason: 'op_status_error' };
      }
    }

    let content = params.lastAssistantContent;
    try {
      const messageModel = new MessageModel(this.db, this.userId, this.workspaceId);
      if (!content && run.assistantMessageId) {
        const msg = await messageModel.findById(run.assistantMessageId);
        content = msg?.content ?? undefined;
      }
      // Placeholder assistant row is often empty; final HTML is a later assistant turn.
      if (!extractOpsHtmlArtifact(content) && run.topicId) {
        const latest = await messageModel.findLatestAssistantWithContentInTopic(run.topicId);
        if (latest?.content) content = latest.content;
      }
    } catch {
      /* best-effort */
    }

    const failed =
      params.reason === 'error' ||
      params.reason === 'failed' ||
      params.reason === 'interrupted' ||
      Boolean(params.errorMessage);

    if (failed) {
      await this.runModel.updateIfStatus(params.runId, ['queued', 'running', 'failed'], {
        status: 'failed',
        stage: 'error',
        finishedAt: new Date(),
        error: {
          code: 'OPS_RUNTIME_ERROR',
          message: params.errorMessage || params.reason || 'runtime error',
          stage: 'running',
          retryable: true,
        },
        progress: {
          stage: 'error',
          percent: 100,
          message: params.errorMessage || 'error',
        },
      } as any);
      return { ok: true as const, reason: 'failed' };
    }

    // Without force, refuse artifact-missing fail (still generating)
    if (!params.force && !extractOpsHtmlArtifact(content)) {
      return { ok: true as const, reason: 'awaiting_artifact' };
    }

    const html = extractOpsHtmlArtifact(content);
    if (!html) {
      await this.runModel.updateIfStatus(params.runId, ['queued', 'running'], {
        status: 'failed',
        stage: 'artifact',
        finishedAt: new Date(),
        error: {
          code: 'OPS_ARTIFACT_MISSING',
          message: 'artifact',
          stage: 'artifact',
          retryable: true,
        },
        progress: {
          stage: 'artifact',
          percent: 100,
          message: 'artifact',
        },
      } as any);
      return { ok: true as const, reason: 'artifact_missing' };
    }

    const cfg = run.config as BusinessFunctionOperationsConfig;
    const meta: BusinessFunctionOperationsResultMeta = {
      kind: 'operations',
      model: cfg?.model,
      promptVersion: cfg?.promptVersion,
      generatedAt: new Date().toISOString(),
      dataSourcesUsed: cfg?.capabilitiesSnapshot?.available,
      dataSourcesMissing: cfg?.capabilitiesSnapshot?.degraded,
      rerunFromId: cfg?.rerunFromId,
    };

    await this.runModel.updateIfStatus(params.runId, ['queued', 'running', 'failed'], {
      status: 'succeeded',
      stage: 'done',
      finishedAt: new Date(),
      resultHtml: html,
      resultMeta: meta,
      progress: { stage: 'done', percent: 100, message: 'done' },
      operationId: opId ?? run.operationId,
    } as any);

    return { ok: true as const, reason: 'succeeded' };
  };

  /** Safe poll reconcile: only finalizes when operation is terminal. */
  reconcileRun = async (runId: string) => {
    const run = await this.runModel.findById(runId);
    if (!run) return null;
    if (run.status !== 'running' && run.status !== 'queued') return run;
    if (!run.operationId && !run.assistantMessageId) return run;

    await this.completeFromOperation({
      runId,
      operationId: run.operationId ?? undefined,
      force: false,
    });
    return this.runModel.findById(runId);
  };

  getRun = async (runId: string, functionId?: string) => {
    const run = await this.runModel.findById(runId);
    if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'OPS_RUN_NOT_FOUND' });
    if (!String(run.functionType).startsWith(FUNCTION_TYPE_PREFIX)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'OPS_RUN_NOT_FOUND' });
    }
    if (functionId && run.functionType !== this.functionType(functionId)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'OPS_RUN_NOT_FOUND' });
    }
    if (run.status === 'running' || run.status === 'queued') {
      return (await this.reconcileRun(runId)) ?? run;
    }
    return run;
  };

  listRuns = async (functionId: string, limit = 20, offset = 0) => {
    const fn = getOperationsFunction(functionId);
    if (!fn) throw new TRPCError({ code: 'NOT_FOUND', message: 'OPS_FUNCTION_NOT_FOUND' });
    const items = await this.runModel.query({
      functionType: this.functionType(functionId),
      light: true,
      limit,
      offset,
    });
    const total = await this.runModel.count({ functionType: this.functionType(functionId) });
    return { items, total };
  };

  /**
   * Finalize from a terminal agent_operations row (used when interrupt returns false).
   * Never assumes success — maps done/error/interrupted/missing correctly.
   * Stuck running (coordinator state gone, DB still running) force-cancels the run.
   */
  private finalizeFromOperationTerminal = async (runId: string, operationId: string) => {
    const opModel = new AgentOperationModel(this.db, this.userId, this.workspaceId);
    const op = await opModel.findById(operationId);

    if (!op) {
      // Op row missing: force-complete from assistant message if any, else leave running
      // only when we have content; otherwise mark failed as missing op.
      return this.completeFromOperation({
        force: true,
        operationId,
        reason: 'error',
        errorMessage: 'OPS_OPERATION_MISSING',
        runId,
      });
    }

    if (OP_RUNNING.has(op.status)) {
      // Coordinator had no interruptible state (or interrupt no-op) while DB still
      // running — common for stuck/never-dispatched ops. User cancel must succeed.
      return this.forceCancelStuckOperation(runId, operationId, opModel);
    }

    if (OP_FAILED.has(op.status)) {
      return this.completeFromOperation({
        force: true,
        operationId,
        reason: 'error',
        errorMessage: op.completionReason || op.status,
        runId,
      });
    }

    // done / success-like
    return this.completeFromOperation({
      force: true,
      operationId,
      reason: op.completionReason || 'done',
      runId,
    });
  };

  /** Mark op interrupted + run canceled when runtime interrupt cannot attach. */
  private forceCancelStuckOperation = async (
    runId: string,
    operationId: string,
    opModel: AgentOperationModel,
  ) => {
    await this.runModel.requestCancel(runId);
    try {
      await opModel.recordCompletion(operationId, {
        completedAt: new Date(),
        completionReason: 'interrupted',
        status: 'interrupted',
      });
    } catch (e) {
      log('cancelRun: force-interrupt op row failed op=%s: %O', operationId, e);
    }
    await this.runModel.updateIfStatus(runId, ['queued', 'running', 'draft'], {
      status: 'canceled',
      stage: 'canceled',
      finishedAt: new Date(),
      progress: { stage: 'canceled', percent: 100, message: 'canceled' },
    } as any);
    return this.runModel.findById(runId);
  };

  private interruptAndCancel = async (runId: string, operationId: string) => {
    let interrupted: boolean;
    try {
      const runtime = new AgentRuntimeService(this.db, this.userId, {
        workspaceId: this.workspaceId,
      });
      interrupted = await runtime.interruptOperation(operationId);
    } catch (e) {
      log('cancelRun: interrupt threw op=%s: %O', operationId, e);
      // Still force-cancel the ops run so the UI is not stuck when runtime is down.
      const opModel = new AgentOperationModel(this.db, this.userId, this.workspaceId);
      const forced = await this.forceCancelStuckOperation(runId, operationId, opModel);
      if (forced && ['canceled', 'succeeded', 'failed'].includes(forced.status)) return forced;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'OPS_CANCEL_FAILED',
        cause: e,
      });
    }

    if (!interrupted) {
      await this.finalizeFromOperationTerminal(runId, operationId);
      return this.runModel.findById(runId);
    }

    await this.runModel.requestCancel(runId);
    await this.runModel.updateIfStatus(runId, ['queued', 'running', 'draft'], {
      status: 'canceled',
      stage: 'canceled',
      finishedAt: new Date(),
      progress: { stage: 'canceled', percent: 100, message: 'canceled' },
    } as any);

    return this.runModel.findById(runId);
  };

  cancelRun = async (runId: string) => {
    // Avoid reconcile side-effects: load raw
    let run = await this.runModel.findById(runId);
    if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'OPS_RUN_NOT_FOUND' });
    if (!String(run.functionType).startsWith(FUNCTION_TYPE_PREFIX)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'OPS_RUN_NOT_FOUND' });
    }
    if (['succeeded', 'failed', 'canceled'].includes(run.status)) return run;

    // No operation yet: only CAS queued/draft (never running without op id).
    if (!run.operationId) {
      await this.runModel.requestCancel(runId);
      const cas = await this.runModel.updateIfStatus(runId, ['queued', 'draft'], {
        status: 'canceled',
        stage: 'canceled',
        finishedAt: new Date(),
        progress: { stage: 'canceled', percent: 100, message: 'canceled' },
      } as any);
      if (cas) return cas;

      // Dispatch raced ahead — re-read and enter interrupt path if op exists
      run = (await this.runModel.findById(runId))!;
      if (['succeeded', 'failed', 'canceled'].includes(run.status)) return run;
      if (!run.operationId) {
        // Still no op but not queued/draft (e.g. running without id) — last resort CAS
        await this.runModel.updateIfStatus(runId, ['running'], {
          status: 'canceled',
          stage: 'canceled',
          finishedAt: new Date(),
          progress: { stage: 'canceled', percent: 100, message: 'canceled' },
        } as any);
        return this.runModel.findById(runId);
      }
    }

    return this.interruptAndCancel(runId, run.operationId!);
  };

  deleteRun = async (runId: string) => {
    const run = await this.runModel.findById(runId);
    if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'OPS_RUN_NOT_FOUND' });
    if (!String(run.functionType).startsWith(FUNCTION_TYPE_PREFIX)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'OPS_RUN_NOT_FOUND' });
    }
    if (['queued', 'running', 'draft', 'auditing', 'exporting'].includes(run.status)) {
      throw new TRPCError({ code: 'CONFLICT', message: 'OPS_RUN_ACTIVE' });
    }
    await this.runModel.delete(runId);
    return { success: true as const };
  };

  rerun = async (runId: string) => {
    const run = await this.getRun(runId);
    const cfg = run.config as BusinessFunctionOperationsConfig;
    if (cfg?.kind !== 'operations') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'OPS_NOT_RERUNNABLE' });
    }
    return this.createRun({
      functionId: cfg.functionId,
      modeId: cfg.modeId,
      model: cfg.model,
      params: cfg.params,
      rerunFromId: run.id,
      workspaceId: this.workspaceId,
    });
  };
}
