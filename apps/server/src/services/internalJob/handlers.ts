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

  if (result.locked) {
    throw new Error(`Step locked for operation ${operationId} step ${stepIndex}`);
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

  queue.start();
  handlersRegistered = true;
  log('internal job handlers registered and workers started');
}
