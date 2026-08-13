import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { runHeartbeatTick } from '@/server/services/taskRunner/heartbeatTick';
import { runScheduleTick } from '@/server/services/taskRunner/scheduleTick';

import { getRedisJobQueue } from './redisJobQueue';
import { JOB_NAMES } from './types';

const log = debug('lobe-server:internal-job:handlers');

/**
 * Execute one agent runtime step (shared by HTTP runStep and internal job worker).
 */
export async function executeAgentRuntimeStepJob(body: Record<string, unknown>): Promise<void> {
  const {
    operationId,
    stepIndex = 0,
    context,
    humanInput,
    approvedToolCall,
    rejectionReason,
    rejectAndContinue,
    resumeAsyncTool,
    finishAfterAsyncTool,
    groupMemberTimeout,
    toolMessageId,
    verifyAsyncToolBarrier,
    asyncToolVerifyAttempt,
  } = { ...body, ...(body.payload as object | undefined) } as Record<string, any>;

  if (!operationId) {
    throw new Error('operationId is required');
  }

  const { AgentRuntimeCoordinator } = await import('@/server/modules/AgentRuntime');
  const { AiAgentService } = await import('@/server/services/aiAgent');
  const { getServerDB } = await import('@/database/core/db-adaptor');

  const coordinator = new AgentRuntimeCoordinator();
  const metadata = await coordinator.getOperationMetadata(String(operationId));

  if (!metadata?.userId) {
    throw new Error(`Invalid operation or no userId for ${operationId}`);
  }

  const serverDB = await getServerDB();
  const aiAgentService = new AiAgentService(serverDB, metadata.userId, {
    workspaceId: metadata.workspaceId,
  });

  const result = await aiAgentService.executeStep({
    approvedToolCall,
    asyncToolVerifyAttempt,
    context,
    finishAfterAsyncTool,
    groupMemberTimeout,
    humanInput,
    operationId: String(operationId),
    rejectAndContinue,
    rejectionReason,
    resumeAsyncTool,
    stepIndex: Number(stepIndex) || 0,
    toolMessageId,
    verifyAsyncToolBarrier,
  });

  // Another worker already holds the step lock — not a failure. Throwing would
  // retry into DLQ while the holder is still executing (ops runs stalled forever).
  if (result.locked) {
    log('step locked for %s step %s — skip (holder in progress)', operationId, stepIndex);
    return;
  }
}

export async function handleBotCompletionJob(payload: unknown): Promise<void> {
  const body = payload as {
    applicationId?: string;
    operationId?: string;
    platformThreadId?: string;
    userId?: string;
  };
  if (!body.applicationId || !body.platformThreadId) {
    throw new Error('bot.completion missing applicationId/platformThreadId');
  }
  const sentKey = body.operationId ? `bot-completion:sent:${body.operationId}` : undefined;
  const redis = sentKey ? getAgentRuntimeRedisClient() : null;
  if (sentKey && redis) {
    const claimed = await redis.set(sentKey, '1', 'EX', 7 * 86_400, 'NX');
    if (claimed !== 'OK') {
      log('bot.completion skip duplicate operationId=%s', body.operationId);
      return;
    }
  }
  try {
    const { getServerDB } = await import('@/database/core/db-adaptor');
    const { BotCallbackService } = await import('@/server/services/bot/BotCallbackService');
    const db = await getServerDB();
    await new BotCallbackService(db).handleCallback(payload as any);
  } catch (error) {
    if (sentKey && redis) await redis.del(sentKey);
    throw error;
  }
}

export async function handleBotDeadlineJob(payload: unknown): Promise<void> {
  const { operationId } = payload as { operationId?: string };
  if (!operationId) throw new Error('bot.deadline requires operationId');

  const { getServerDB } = await import('@/database/core/db-adaptor');
  const { finalizeInactiveBotOperation } =
    await import('@/server/services/agentRuntime/stuckOperationWatchdog');
  const db = await getServerDB();
  const result = await finalizeInactiveBotOperation(db, operationId);

  if (result.status === 'active' && result.retryAfterMs) {
    const { enqueueInternalJob } = await import('./enqueue');
    await enqueueInternalJob({
      delayMs: result.retryAfterMs,
      maxAttempts: 1,
      name: JOB_NAMES.botDeadline,
      payload,
    });
  }
}

let handlersRegistered = false;

/**
 * Register built-in job handlers and start workers (idempotent).
 */
export function ensureInternalJobWorkersStarted(): void {
  if (handlersRegistered) return;

  const redis = getAgentRuntimeRedisClient();
  if (!redis) {
    log('Redis unavailable — internal job workers not started');
    return;
  }

  const queue = getRedisJobQueue(redis);

  queue.register(JOB_NAMES.agentRuntimeStep, async (payload) => {
    await executeAgentRuntimeStepJob(payload as Record<string, unknown>);
  });

  queue.register(JOB_NAMES.taskHeartbeatTick, async (payload) => {
    const { taskId, userId } = payload as { taskId?: string; userId?: string };
    if (!taskId || !userId) throw new Error('task.heartbeat-tick requires taskId and userId');
    await runHeartbeatTick(taskId, userId);
  });

  queue.register(JOB_NAMES.taskScheduleExecute, async (payload) => {
    const { taskId, userId } = payload as { taskId?: string; userId?: string };
    if (!taskId || !userId) throw new Error('task.schedule-execute requires taskId and userId');
    await runScheduleTick(taskId, userId);
  });

  // Scheduler V2: claim + run a single automation ledger run.
  queue.register(JOB_NAMES.taskAutomationExecute, async (payload) => {
    const { runId } = payload as { runId?: string };
    if (!runId) throw new Error('task.automation-execute requires runId');
    const { getServerDB } = await import('@/database/server');
    const { processAutomationRun } = await import('@/server/services/taskAutomation');
    const db = await getServerDB();
    await processAutomationRun(db, runId);
  });

  // Full sweep (optional enqueue path). Primary clock is startScheduleDispatchCron.
  queue.register(JOB_NAMES.taskScheduleDispatch, async (payload) => {
    const { runScheduleDispatchSweep } =
      await import('@/server/services/taskRunner/scheduleDispatchSweep');
    const body = (payload || {}) as { dryRun?: boolean };
    await runScheduleDispatchSweep({ dryRun: body.dryRun === true });
  });

  queue.register(JOB_NAMES.memoryProcessUsers, async (payload) => {
    const { runMemoryProcessUsers } =
      await import('@/server/services/memory/userMemory/jobOrchestrator');
    await runMemoryProcessUsers(payload as any);
  });

  queue.register(JOB_NAMES.memoryProcessUserTopics, async (payload) => {
    const { runMemoryProcessUserTopics } =
      await import('@/server/services/memory/userMemory/jobOrchestrator');
    await runMemoryProcessUserTopics(payload as any);
  });

  queue.register(JOB_NAMES.memoryProcessTopics, async (payload) => {
    const { runMemoryProcessTopics } =
      await import('@/server/services/memory/userMemory/jobOrchestrator');
    await runMemoryProcessTopics(payload as any);
  });

  queue.register(JOB_NAMES.memoryProcessTopic, async (payload) => {
    const { runMemoryProcessTopic } =
      await import('@/server/services/memory/userMemory/jobOrchestrator');
    await runMemoryProcessTopic(payload as any);
  });

  queue.register(JOB_NAMES.memoryHourly, async (payload) => {
    const { runMemoryHourly } = await import('@/server/services/memory/userMemory/jobOrchestrator');
    await runMemoryHourly(payload as any);
  });

  queue.register(JOB_NAMES.memoryDaily, async (payload) => {
    const { runMemoryDaily } = await import('@/server/services/memory/userMemory/jobOrchestrator');
    await runMemoryDaily(payload as any);
  });

  queue.register(JOB_NAMES.memoryPersonaUpdate, async (payload) => {
    const { runMemoryPersonaUpdate } =
      await import('@/server/services/memory/userMemory/jobOrchestrator');
    await runMemoryPersonaUpdate(payload as any);
  });

  queue.register(JOB_NAMES.agentSignalRun, async (payload) => {
    const { runAgentSignalWorkflow } = await import('@/server/workflows/agentSignal/run');
    await runAgentSignalWorkflow({
      requestPayload: payload as any,
      run: async (_stepId, handler) => handler(),
    });
  });

  queue.register(JOB_NAMES.agentSignalNightlyReview, async (payload) => {
    const { createServerNightlyReviewScheduleService } =
      await import('@/server/services/agentSignal/services');
    const { getServerDB } = await import('@/database/server');
    const db = await getServerDB();
    const service = createServerNightlyReviewScheduleService(db);
    const body = (payload || {}) as {
      cursor?: { createdAt: string; id: string };
      limit?: number;
      targetLimit?: number;
      whitelist?: string[];
    };
    await service.dispatchNightlyReviewRequests({
      cursor: body.cursor
        ? { createdAt: new Date(body.cursor.createdAt), id: body.cursor.id }
        : undefined,
      limit: body.limit,
      targetLimit: body.targetLimit,
      whitelist: body.whitelist,
    });
  });

  queue.register(JOB_NAMES.verifyComplete, async (payload) => {
    const body = payload as {
      checkItemId?: string;
      errorMessage?: string;
      operationId?: string;
      parentOperationId?: string;
      reason?: string;
      userId?: string;
      workspaceId?: string;
    };
    if (!body.checkItemId || !body.operationId || !body.parentOperationId || !body.userId) {
      throw new Error('verify.on-complete missing required fields');
    }
    const { getServerDB } = await import('@/database/server');
    const { settleVerifierCheckFromTerminal } =
      await import('@/server/services/verify/verifierTerminal');
    const db = await getServerDB();
    await settleVerifierCheckFromTerminal(
      db,
      body.userId,
      {
        checkItemId: body.checkItemId,
        errorMessage: body.errorMessage,
        parentOperationId: body.parentOperationId,
        reason: body.reason,
        verifierOperationId: body.operationId,
      },
      body.workspaceId,
    );
  });

  // Ops function runs: avoid Upstash Workflow signature on the HTTP route when
  // AGENT_RUNTIME_MODE=queue delivers onComplete via internal fetch/qstash path.
  queue.register(JOB_NAMES.botCompletion, handleBotCompletionJob);

  queue.register(JOB_NAMES.botDeadline, handleBotDeadlineJob);

  queue.register(JOB_NAMES.opsFunctionComplete, async (payload) => {
    const body = payload as {
      errorMessage?: string;
      lastAssistantContent?: string;
      operationId?: string;
      reason?: string;
      runId?: string;
      userId?: string;
      workspaceId?: string;
    };
    if (!body.runId || !body.userId || !body.workspaceId) {
      throw new Error('ops.function.on-complete missing runId/userId/workspaceId');
    }
    const { getServerDB } = await import('@/database/server');
    const { OperationsFunctionService } = await import('@/server/services/operationsFunction');
    const db = await getServerDB();
    const service = new OperationsFunctionService(db, body.userId, body.workspaceId);
    await service.completeFromOperation({
      errorMessage: body.errorMessage,
      force: true,
      lastAssistantContent: body.lastAssistantContent,
      operationId: body.operationId,
      reason: body.reason,
      runId: body.runId,
    });
  });

  queue.start();
  handlersRegistered = true;
  log('internal job handlers registered and workers started');
}
