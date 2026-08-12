import { TASK_STATUSES } from '@lobechat/builtin-tool-task';
import type { TaskListItem, TaskParticipant } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { assertTaskAssigneeUsableBy } from '@/database/utils/agent-access';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { EditLockService } from '@/server/services/editLock';
import { publishResourceEvent } from '@/server/services/resourceEvents';
import { TaskService } from '@/server/services/task';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';
import { TaskRunnerService } from '@/server/services/taskRunner';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';
import { TransferErrorCode } from '@/types/transferError';

const taskProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;
  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, wsId),
      briefModel: new BriefModel(ctx.serverDB, ctx.userId, wsId),
      editLockService: new EditLockService(ctx.userId),
      taskLifecycle: new TaskLifecycleService(ctx.serverDB, ctx.userId, wsId),
      taskModel: new TaskModel(ctx.serverDB, ctx.userId, wsId),
      taskService: new TaskService(ctx.serverDB, ctx.userId, wsId),
      taskTopicModel: new TaskTopicModel(ctx.serverDB, ctx.userId, wsId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

// Write variant gates viewers out of every task mutation (create/update/delete/
// run). Reads keep using `taskProcedure` so viewers can still inspect tasks
// and their status.
const taskProcedureWrite = taskProcedure.use(withScopedPermission('agent:update'));

// All procedures that take an id accept either raw id (task_xxx) or identifier (TASK-1)
// Resolution happens in the model layer via model.resolve()
const idInput = z.object({ id: z.string() });

// Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
const createSchema = z.object({
  assigneeAgentId: z.string().optional(),
  assigneeUserId: z.string().optional(),
  // Optional schedule wiring at create time. When `automationMode` is
  // 'schedule', `schedulePattern` (cron) is required for the central
  // schedule-dispatch sweep to pick the task up.
  automationMode: z.enum(['heartbeat', 'schedule', 'event']).optional(),
  createdByAgentId: z.string().optional(),
  description: z.string().optional(),
  editorData: z.unknown().optional(),
  eventCooldownSeconds: z.number().int().min(0).max(86_400).optional(),
  eventFilter: z
    .array(
      z.object({
        field: z.string(),
        op: z.enum(['eq', 'in']),
        value: z.union([z.string(), z.array(z.string())]),
      }),
    )
    .max(5)
    .optional(),
  eventSourceType: z.string().optional(),
  identifierPrefix: z.string().optional(),
  instruction: z.string().min(1),
  name: z.string().optional(),
  overduePolicy: z.enum(['latest', 'skip', 'all']).optional(),
  parentTaskId: z.string().optional(),
  priority: z.number().min(0).max(4).optional(),
  scheduleAt: z.string().datetime().optional(),
  scheduleEverySeconds: z.number().int().min(60).optional(),
  scheduleKind: z.enum(['at', 'every', 'cron']).optional(),
  schedulePattern: z.string().optional(),
  scheduleTimezone: z.string().optional(),
  // When omitted, the server derives visibility from the parent task or the
  // assignee agent's visibility (private agent → private task). UI surfaces
  // such as the top-level "Tasks" create form pass it explicitly.
  visibility: z.enum(['private', 'public']).optional(),
});

const updateSchema = z.object({
  assigneeAgentId: z.string().nullish(),
  assigneeUserId: z.string().nullish(),
  automationMode: z.enum(['heartbeat', 'schedule', 'event']).nullish(),
  config: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
  editorData: z.unknown().optional(),
  eventCooldownSeconds: z.number().int().min(0).max(86_400).nullish(),
  eventFilter: z
    .array(
      z.object({
        field: z.string(),
        op: z.enum(['eq', 'in']),
        value: z.union([z.string(), z.array(z.string())]),
      }),
    )
    .max(5)
    .nullish(),
  eventSourceType: z.string().nullish(),
  // 0 clears the interval (disables heartbeat); any positive value must be
  // ≥600s (10 min) to match the UI minimum and prevent sub-minute ticks if an
  // LLM calls setTaskSchedule with a tiny number.
  heartbeatInterval: z
    .number()
    .int()
    .refine((v) => v === 0 || v >= 600, {
      message: 'heartbeatInterval must be 0 (disabled) or at least 600 seconds (10 minutes)',
    })
    .optional(),
  heartbeatTimeout: z.number().min(1).nullish(),
  instruction: z.string().optional(),
  name: z.string().optional(),
  overduePolicy: z.enum(['latest', 'skip', 'all']).nullish(),
  pacingMaxSeconds: z
    .number()
    .int()
    .min(600)
    .max(30 * 86_400)
    .nullish(),
  pacingMinSeconds: z.number().int().min(60).max(86_400).nullish(),
  parentTaskId: z.string().nullish(),
  priority: z.number().min(0).max(4).optional(),
  scheduleAt: z.string().datetime().nullish(),
  scheduleEverySeconds: z.number().int().min(60).nullish(),
  scheduleKind: z.enum(['at', 'every', 'cron']).nullish(),
  schedulePattern: z.string().nullish(),
  scheduleTimezone: z.string().nullish(),
});

const listSchema = z.object({
  assigneeAgentId: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  parentIdentifier: z.string().optional(),
  parentTaskId: z.string().nullish(),
  priorities: z.array(z.number().min(0).max(4)).max(5).optional(),
  statuses: z.array(z.enum(TASK_STATUSES)).max(10).optional(),
  // UI-side narrowing of the result set. Omitted means "All" (the chip's
  // default 'private' is enforced client-side; the server stays permissive
  // so router tests / external callers don't have to know the chip).
  visibility: z.enum(['private', 'public']).optional(),
});

const groupListSchema = z.object({
  assigneeAgentId: z.string().optional(),
  groups: z
    .array(
      z.object({
        key: z.string(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        statuses: z.array(z.string()).min(1).max(10),
      }),
    )
    .min(1)
    .max(10),
  parentTaskId: z.string().nullish(),
  visibility: z.enum(['private', 'public']).optional(),
});

// Helper: resolve id/identifier and throw if not found
async function resolveOrThrow(model: TaskModel, id: string) {
  const task = await model.resolve(id);
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
  return task;
}

async function assertAssigneeAgentBelongsToUser(
  db: LobeChatDatabase,
  callerCtx: { userId: string; workspaceId?: string },
  assigneeAgentId?: string | null,
) {
  if (!assigneeAgentId) return;

  try {
    // Allows workspace-member inbox agents (colleague assistants), not only
    // public/own agents — see assertTaskAssigneeUsableBy.
    await assertTaskAssigneeUsableBy(db, assigneeAgentId, callerCtx);
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') {
      // Preserve the task-context message so the UI surfaces "Assignee agent
      // not found" instead of the generic "Agent not found". Cross-user access
      // to a private non-inbox agent still resolves to NOT_FOUND.
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Assignee agent not found' });
    }
    throw error;
  }
}

async function resolveSafeParentTaskId(
  model: TaskModel,
  taskId: string,
  parentTaskId: string | null,
): Promise<string | null> {
  if (parentTaskId === null) return null;

  const parent = await resolveOrThrow(model, parentTaskId);
  if (parent.id === taskId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Task cannot be parented to itself',
    });
  }

  const descendants = await model.findAllDescendants(taskId);
  if (descendants.some((task) => task.id === parent.id)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Task cannot be parented to its own descendant',
    });
  }

  return parent.id;
}

export const taskRouter = router({
  reorderSubtasks: taskProcedureWrite
    .input(
      z.object({
        id: z.string(),
        // Ordered list of subtask identifiers (e.g. ['TASK-2', 'TASK-4', 'TASK-3'])
        order: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.id);
        const subtasks = await model.findSubtasks(task.id);

        // Build identifier → id map
        const idMap = new Map<string, string>();
        for (const s of subtasks) idMap.set(s.identifier, s.id);

        // Validate all identifiers exist
        const reorderItems: Array<{ id: string; sortOrder: number }> = [];
        for (let i = 0; i < input.order.length; i++) {
          const identifier = input.order[i].toUpperCase();
          const taskId = idMap.get(identifier);
          if (!taskId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Subtask not found: ${identifier}`,
            });
          }
          reorderItems.push({ id: taskId, sortOrder: i });
        }

        await model.reorder(reorderItems);

        return {
          data: reorderItems.map((item, i) => ({
            identifier: input.order[i],
            sortOrder: item.sortOrder,
          })),
          message: 'Subtasks reordered',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:reorderSubtasks]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to reorder subtasks',
        });
      }
    }),

  addComment: taskProcedureWrite
    .input(
      z.object({
        authorAgentId: z.string().optional(),
        briefId: z.string().optional(),
        content: z.string().min(1),
        editorData: z.unknown().optional(),
        id: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.id);
        await assertAssigneeAgentBelongsToUser(
          ctx.serverDB,
          { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
          input.authorAgentId,
        );
        const comment = await model.addComment({
          authorAgentId: input.authorAgentId,
          authorUserId: input.authorAgentId ? undefined : ctx.userId,
          briefId: input.briefId,
          content: input.content,
          editorData: input.editorData as never,
          taskId: task.id,
          topicId: input.topicId,
          userId: ctx.userId,
        });
        return { data: comment, message: 'Comment added', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:addComment]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add comment',
        });
      }
    }),

  deleteComment: taskProcedureWrite
    .input(z.object({ commentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const deleted = await ctx.taskModel.deleteComment(input.commentId);
        if (!deleted) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
        }
        return { message: 'Comment deleted', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:deleteComment]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete comment',
        });
      }
    }),

  updateComment: taskProcedureWrite
    .input(
      z.object({
        commentId: z.string(),
        content: z.string().min(1),
        editorData: z.unknown().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const comment = await ctx.taskModel.updateComment(input.commentId, input.content, {
          editorData: input.editorData,
        });
        if (!comment) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
        }
        return { data: comment, message: 'Comment updated', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateComment]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update comment',
        });
      }
    }),

  addDependency: taskProcedureWrite
    .input(
      z.object({
        dependsOnId: z.string(),
        taskId: z.string(),
        type: z.enum(['blocks', 'relates']).default('blocks'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
        const dep = await resolveOrThrow(model, input.dependsOnId);
        await model.addDependency(task.id, dep.id, input.type);
        return { message: 'Dependency added', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:addDependency]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add dependency',
        });
      }
    }),

  cancelTopic: taskProcedureWrite
    .input(z.object({ topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await ctx.taskService.cancelTopic(input.topicId);
        return { message: 'Topic canceled', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:cancelTopic]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to cancel topic',
        });
      }
    }),

  deleteTopic: taskProcedureWrite
    .input(z.object({ topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await ctx.taskService.deleteTopic(input.topicId);
        return { message: 'Topic deleted', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:deleteTopic]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete topic',
        });
      }
    }),

  create: taskProcedureWrite.input(createSchema).mutation(async ({ input, ctx }) => {
    try {
      await assertAssigneeAgentBelongsToUser(
        ctx.serverDB,
        { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
        input.assigneeAgentId,
      );
      const task = await ctx.taskService.createTask(input);
      return { data: task, message: 'Task created', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:create]', error);
      const causeMessage = error instanceof Error ? error.message : String(error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: causeMessage ? `Failed to create task: ${causeMessage}` : 'Failed to create task',
      });
    }
  }),

  clearAll: taskProcedureWrite.mutation(async ({ ctx }) => {
    try {
      const model = ctx.taskModel;
      const count = await model.deleteAll();
      return { count, message: `${count} tasks deleted`, success: true };
    } catch (error) {
      console.error('[task:clearAll]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to clear tasks',
      });
    }
  }),

  delete: taskProcedureWrite.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      await model.delete(task.id);
      return { data: task, message: 'Task deleted', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:delete]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete task',
      });
    }
  }),

  detail: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const detail = await ctx.taskService.getTaskDetail(input.id);
      if (!detail) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      return { data: detail, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:detail]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task detail',
      });
    }
  }),

  find: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      return { data: task, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:find]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to find task',
      });
    }
  }),

  getDependencies: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const deps = await model.getDependencies(task.id);
      return { data: deps, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getDependencies]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get dependencies',
      });
    }
  }),

  getPinnedDocuments: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const docs = await model.getPinnedDocuments(task.id);
      return { data: docs, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getPinnedDocuments]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get documents',
      });
    }
  }),

  getTopics: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const results = await ctx.taskTopicModel.findWithDetails(task.id);
      return { data: results, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getTopics]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task topics',
      });
    }
  }),

  getSubtasks: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const subtasks = await model.findSubtasks(task.id);
      return { data: subtasks, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getSubtasks]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get subtasks',
      });
    }
  }),

  getTaskTree: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const tree = await model.getTaskTree(task.id);
      return { data: tree, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getTaskTree]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task tree',
      });
    }
  }),

  heartbeat: taskProcedureWrite.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      await model.updateHeartbeat(task.id);
      return { message: 'Heartbeat updated', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:heartbeat]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update heartbeat',
      });
    }
  }),

  watchdog: taskProcedureWrite.mutation(async ({ ctx }) => {
    try {
      const { runTaskAutomationWatchdog } =
        await import('@/server/services/taskAutomation/watchdog');
      return await runTaskAutomationWatchdog(ctx.serverDB);
    } catch (error) {
      console.error('[task:watchdog]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Watchdog check failed',
      });
    }
  }),

  previewAutomation: taskProcedure
    .input(
      z.object({
        automationMode: z.enum(['heartbeat', 'schedule', 'event']).nullish(),
        count: z.number().int().min(1).max(10).default(5),
        heartbeatInterval: z.number().int().optional(),
        scheduleAt: z.string().datetime().nullish(),
        scheduleEverySeconds: z.number().int().nullish(),
        scheduleKind: z.enum(['at', 'every', 'cron']).nullish(),
        schedulePattern: z.string().nullish(),
        scheduleTimezone: z.string().nullish(),
      }),
    )
    .query(async ({ input }) => {
      const { previewScheduleFires } = await import('@/server/services/taskAutomation/nextRun');
      const fires = previewScheduleFires(
        {
          automationMode: input.automationMode ?? 'schedule',
          heartbeatInterval: input.heartbeatInterval ?? null,
          scheduleAt: input.scheduleAt ? new Date(input.scheduleAt) : null,
          scheduleEverySeconds: input.scheduleEverySeconds ?? null,
          scheduleKind: input.scheduleKind ?? null,
          schedulePattern: input.schedulePattern ?? null,
          scheduleTimezone: input.scheduleTimezone ?? 'UTC',
        } as any,
        input.count,
      );
      return {
        fires: fires.map((d) => d.toISOString()),
        success: true as const,
      };
    }),

  listAutomationRuns: taskProcedure
    .input(
      z.object({
        cursor: z.string().nullish(),
        id: z.string(),
        limit: z.number().int().min(1).max(100).default(20),
        status: z
          .union([
            z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped', 'canceled']),
            z.array(z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped', 'canceled'])),
          ])
          .optional(),
        trigger: z
          .union([
            z.enum(['schedule', 'heartbeat', 'event']),
            z.array(z.enum(['schedule', 'heartbeat', 'event'])),
          ])
          .optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const task = await resolveOrThrow(ctx.taskModel, input.id);
      const { TaskAutomationModel } = await import('@/database/models/taskAutomation');
      const model = new TaskAutomationModel(ctx.serverDB);
      const result = await model.listRunsForTask({
        cursor: input.cursor,
        limit: input.limit,
        status: input.status as any,
        taskId: task.id,
        trigger: input.trigger as any,
      });
      return { ...result, success: true as const };
    }),

  retryAutomationRun: taskProcedureWrite
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { TaskAutomationModel } = await import('@/database/models/taskAutomation');
      const model = new TaskAutomationModel(ctx.serverDB);
      const existing = await model.findRunById(input.runId);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      // Ownership: run must belong to a task the caller can write.
      await resolveOrThrow(ctx.taskModel, existing.taskId);
      const run = await model.retryRun(input.runId);
      if (!run) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Run is not in a retryable terminal state',
        });
      }
      return { run, success: true as const };
    }),

  cancelAutomationRun: taskProcedureWrite
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { TaskAutomationModel } = await import('@/database/models/taskAutomation');
      const model = new TaskAutomationModel(ctx.serverDB);
      const existing = await model.findRunById(input.runId);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
      await resolveOrThrow(ctx.taskModel, existing.taskId);
      const run = await model.cancelRun(input.runId);
      if (!run) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only pending runs can be canceled',
        });
      }
      return { run, success: true as const };
    }),

  groupList: taskProcedure.input(groupListSchema).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const groups = await model.groupList(input);
      return { data: groups, success: true };
    } catch (error) {
      console.error('[task:groupList]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch grouped tasks',
      });
    }
  }),

  /**
   * Agents that may be selected as task assignees for the current workspace
   * (or personal scope). Includes every member's inbox assistant so company
   * users can assign work to a colleague's agent.
   */
  listAssignableAgents: taskProcedure.query(async ({ ctx }) => {
    try {
      const agents = await ctx.agentModel.listAssignableForTasks();
      return { data: agents, success: true as const };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:listAssignableAgents]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list assignable agents',
      });
    }
  }),

  list: taskProcedure.input(listSchema).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const { parentIdentifier, ...query } = input;
      let parentTaskId = query.parentTaskId;

      if (parentIdentifier) {
        const parent = await model.resolve(parentIdentifier);
        if (!parent) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Parent task not found: ${parentIdentifier}`,
          });
        }

        parentTaskId = parent.id;
      }

      const result = await model.list({
        ...query,
        parentTaskId,
      });

      const assigneeIds = [
        ...new Set(result.tasks.map((t) => t.assigneeAgentId).filter((id): id is string => !!id)),
      ];
      const agents =
        assigneeIds.length > 0 ? await ctx.agentModel.getAgentAvatarsByIds(assigneeIds) : [];
      const agentMap = new Map(agents.map((a) => [a.id, a]));

      const data: TaskListItem[] = result.tasks.map((task) => {
        const participants: TaskParticipant[] = [];
        if (task.assigneeAgentId) {
          const agent = agentMap.get(task.assigneeAgentId);
          if (agent) {
            participants.push({
              avatar: agent.avatar,
              backgroundColor: agent.backgroundColor,
              id: agent.id,
              title: agent.title ?? '',
              type: 'agent',
            });
          }
        }
        return { ...task, participants };
      });

      return { data, success: true, total: result.total };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:list]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list tasks',
      });
    }
  }),

  run: taskProcedureWrite
    .input(
      idInput.merge(
        z.object({
          continueTopicId: z.string().optional(),
          prompt: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const runner = new TaskRunnerService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        return await runner.runTask({
          continueTopicId: input.continueTopicId,
          extraPrompt: input.prompt,
          taskId: input.id,
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:run]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to run task',
        });
      }
    }),

  pinDocument: taskProcedureWrite
    .input(
      z.object({
        documentId: z.string(),
        pinnedBy: z.string().default('user'),
        taskId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
        await model.pinDocument(task.id, input.documentId, input.pinnedBy);
        return { message: 'Document pinned', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:pinDocument]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to pin document',
        });
      }
    }),

  removeDependency: taskProcedureWrite
    .input(z.object({ dependsOnId: z.string(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
        const dep = await resolveOrThrow(model, input.dependsOnId);
        await model.removeDependency(task.id, dep.id);
        return { message: 'Dependency removed', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:removeDependency]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to remove dependency',
        });
      }
    }),

  unpinDocument: taskProcedureWrite
    .input(z.object({ documentId: z.string(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
        await model.unpinDocument(task.id, input.documentId);
        return { message: 'Document unpinned', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:unpinDocument]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to unpin document',
        });
      }
    }),

  getCheckpoint: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const checkpoint = model.getCheckpointConfig(task);
      return { data: checkpoint, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getCheckpoint]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get checkpoint',
      });
    }
  }),

  updateCheckpoint: taskProcedureWrite
    .input(
      idInput.merge(
        z.object({
          checkpoint: z.object({
            onAgentRequest: z.boolean().optional(),
            tasks: z
              .object({
                afterIds: z.array(z.string()).optional(),
                beforeIds: z.array(z.string()).optional(),
              })
              .optional(),
            topic: z
              .object({
                after: z.boolean().optional(),
                before: z.boolean().optional(),
              })
              .optional(),
          }),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, checkpoint } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveOrThrow(model, id);
        const task = await model.updateCheckpointConfig(resolved.id, checkpoint);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return {
          data: model.getCheckpointConfig(task),
          message: 'Checkpoint updated',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateCheckpoint]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update checkpoint',
        });
      }
    }),

  getReview: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      return { data: model.getReviewConfig(task) || null, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getReview]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get review config',
      });
    }
  }),

  updateReview: taskProcedureWrite
    .input(
      idInput.merge(
        z.object({
          review: z.object({
            autoRetry: z.boolean().default(true),
            enabled: z.boolean(),
            judge: z
              .object({
                model: z.string().optional(),
                provider: z.string().optional(),
              })
              .default({}),
            maxIterations: z.number().min(1).max(10).default(3),
            rubrics: z.array(
              z.object({
                config: z.record(z.string(), z.unknown()),
                extractor: z.record(z.string(), z.unknown()).optional(),
                id: z.string(),
                name: z.string(),
                threshold: z.number().min(0).max(1).optional(),
                type: z.string(),
                weight: z.number().default(1),
              }),
            ),
          }),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, review } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveOrThrow(model, id);
        const task = await model.updateReviewConfig(resolved.id, review);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return {
          data: model.getReviewConfig(task),
          message: 'Review config updated',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateReview]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update review config',
        });
      }
    }),

  getVerifyConfig: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      return { data: model.getVerifyConfig(task) || null, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getVerifyConfig]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get verify config',
      });
    }
  }),

  updateVerifyConfig: taskProcedureWrite
    .input(
      idInput.merge(
        z.object({
          // `.nullish()` lets callers clear a saved field: `null` removes it
          // (JSON can't send `undefined`), omission leaves it untouched. See
          // TaskModel.updateVerifyConfig.
          verify: z.object({
            enabled: z.boolean().nullish(),
            maxIterations: z.number().min(1).max(10).nullish(),
            requirement: z.string().nullish(),
            verifierAgentId: z.string().nullish(),
            verifyCriteriaIds: z.array(z.string()).nullish(),
            verifyRubricId: z.string().nullish(),
          }),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, verify } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveOrThrow(model, id);
        const task = await model.updateVerifyConfig(resolved.id, verify);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return {
          data: model.getVerifyConfig(task),
          message: 'Verify config updated',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateVerifyConfig]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update verify config',
        });
      }
    }),

  runReview: taskProcedureWrite
    .input(
      idInput.merge(
        z.object({
          content: z.string().optional(),
          topicId: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.taskService.runReview(input);
        return { data: result, success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:runReview]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to run review',
        });
      }
    }),

  update: taskProcedureWrite.input(idInput.merge(updateSchema)).mutation(async ({ input, ctx }) => {
    const { id, parentTaskId, ...data } = input;
    try {
      const model = ctx.taskModel;
      await assertAssigneeAgentBelongsToUser(
        ctx.serverDB,
        { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
        data.assigneeAgentId,
      );
      const resolved = await resolveOrThrow(model, id);

      // Collaborative edit lock: reject writes to a workspace task another member
      // is actively editing. Inert until a client acquires the lock.
      if (ctx.workspaceId) {
        const blockedBy = await ctx.editLockService.getBlockingHolder('task', resolved.id);
        if (blockedBy) {
          throw new TRPCError({
            cause: { data: { code: 'DocumentLocked' } },
            code: 'CONFLICT',
            message: 'Task is being edited by another user',
          });
        }
      }

      // Reject changing the assignee to a private agent on a public task —
      // a public task must never be assigned to a private agent.
      // Workspace member inboxes are an exception: they stay private for chat
      // but remain valid public-task assignees (company collaboration).
      // `undefined` means "no change"; `null` clears the assignee and is
      // always safe.
      if (data.assigneeAgentId) {
        const ownedVisibility = await ctx.agentModel.getAgentVisibility(data.assigneeAgentId);
        const agentVisibility =
          ownedVisibility ?? (await ctx.agentModel.getTaskAssigneeVisibility(data.assigneeAgentId));
        // ownedVisibility null + assignee-visible = colleague inbox (or similar
        // task-only grant). Skip the public-task/private-agent block for those.
        const isTaskOnlyAssignee = ownedVisibility === null && agentVisibility !== null;
        if (!(isTaskOnlyAssignee && resolved.visibility === 'public')) {
          ctx.taskService.assertAgentVisibilityCompat(resolved.visibility, agentVisibility);
        }
      }

      const resolvedParentTaskId =
        parentTaskId === undefined
          ? undefined
          : await resolveSafeParentTaskId(model, resolved.id, parentTaskId);

      // Reparenting a public task under a private one breaks the parent
      // visibility invariant — a subtask cannot be more public than its
      // parent (otherwise workspace members would still see the child while
      // its new parent is hidden). `undefined` means "no change"; `null`
      // clears the parent and is always safe.
      if (resolvedParentTaskId) {
        const newParent = await model.findById(resolvedParentTaskId);
        ctx.taskService.assertParentVisibilityCompat(resolved.visibility, newParent?.visibility);
      }

      const updateData =
        parentTaskId === undefined ? data : { ...data, parentTaskId: resolvedParentTaskId };

      // Bump automation_revision when schedule config changes so in-flight
      // ledger runs with the old revision are skipped by the worker.
      const automationKeys = [
        'automationMode',
        'eventCooldownSeconds',
        'eventFilter',
        'eventSourceType',
        'heartbeatInterval',
        'overduePolicy',
        'pacingMaxSeconds',
        'pacingMinSeconds',
        'scheduleAt',
        'scheduleEverySeconds',
        'scheduleKind',
        'schedulePattern',
        'scheduleTimezone',
      ] as const;
      const touchesAutomation = automationKeys.some(
        (k) => (updateData as Record<string, unknown>)[k] !== undefined,
      );
      if (touchesAutomation) {
        try {
          const { TaskAutomationModel } = await import('@/database/models/taskAutomation');
          await new TaskAutomationModel(ctx.serverDB).bumpAutomationRevision(resolved.id);
        } catch (e) {
          console.error('[task:update] bumpAutomationRevision failed:', e);
        }
      }

      const task = await model.update(resolved.id, updateData);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      return { data: task, message: 'Task updated', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:update]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update task',
      });
    }
  }),

  updateVisibility: taskProcedureWrite
    .input(idInput.merge(z.object({ visibility: z.enum(['private', 'public']) })))
    .mutation(async ({ input, ctx }) => {
      try {
        const resolved = await resolveOrThrow(ctx.taskModel, input.id);

        // Mirror the edit-lock contract from `update`: reject visibility flips
        // while another workspace member is actively editing this task. Without
        // this check a collaborator could silently retitle a private task to
        // public (or vice versa) while you're mid-edit.
        if (ctx.workspaceId) {
          const blockedBy = await ctx.editLockService.getBlockingHolder('task', resolved.id);
          if (blockedBy) {
            throw new TRPCError({
              cause: { data: { code: 'DocumentLocked' } },
              code: 'CONFLICT',
              message: 'Task is being edited by another user',
            });
          }
        }

        // Owner can always change visibility on their own tasks. In workspace
        // mode, allow workspace owners to override (mirrors the transferTask
        // policy at line ~1166): only they can change visibility on tasks
        // created by other members.
        if (ctx.workspaceId && resolved.createdByUserId !== ctx.userId) {
          const canOverride = await hasWorkspaceScopedPermission({
            action: 'AGENT_UPDATE',
            db: ctx.serverDB,
            scopes: ['ALL'],
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
          });
          if (!canOverride) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Only the task creator or workspace owner can change visibility',
            });
          }
        }

        // Demoting a mixed-creator subtree would fracture it: each descendant
        // stays owned by its creator, so the root creator loses other
        // members' subtasks while those members keep orphaned children whose
        // parent is hidden. Reject early — the subtree must be single-creator
        // to go private.
        if (input.visibility === 'private') {
          const hasOtherCreators = await ctx.taskModel.subtreeHasOtherCreators(
            resolved.id,
            resolved.createdByUserId,
          );
          if (hasOtherCreators) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Cannot make this task private while it has subtasks created by other members. Reassign or remove those subtasks first.',
            });
          }
        }

        // Promoting a task to public while a private agent is its assignee
        // breaks the visibility invariant. Reject early — the user should
        // reassign first, then promote.
        if (input.visibility === 'public' && resolved.assigneeAgentId) {
          const agentVisibility = await ctx.agentModel.getAgentVisibility(resolved.assigneeAgentId);
          ctx.taskService.assertAgentVisibilityCompat(input.visibility, agentVisibility);
        }

        // Promoting a subtask to public while its parent is still private
        // would orphan the child in the workspace view — a subtask cannot
        // be more public than its parent. The user must promote the parent
        // chain first, or keep the subtask private.
        if (input.visibility === 'public' && resolved.parentTaskId) {
          const parent = await ctx.taskModel.findById(resolved.parentTaskId);
          ctx.taskService.assertParentVisibilityCompat(input.visibility, parent?.visibility);
        }

        const updated = await ctx.taskModel.updateVisibility(resolved.id, input.visibility);
        if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return { data: updated, message: 'Task visibility updated', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateVisibility]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update task visibility',
        });
      }
    }),

  acquireTaskLock: taskProcedureWrite.input(idInput).mutation(async ({ ctx, input }) => {
    if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
    const resolved = await resolveOrThrow(ctx.taskModel, input.id);
    const prev = await ctx.editLockService.getActiveHolder('task', resolved.id);
    const result = await ctx.editLockService.acquire('task', resolved.id);
    if ((result.holderId ?? null) !== (prev ?? null)) {
      void publishResourceEvent(
        { id: resolved.id, type: 'task' },
        { actorId: ctx.userId, data: { holderId: result.holderId }, type: 'lock.changed' },
      );
    }
    return result;
  }),

  getTaskLock: taskProcedureWrite.input(idInput).query(async ({ ctx, input }) => {
    if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
    const resolved = await resolveOrThrow(ctx.taskModel, input.id);
    const holder = await ctx.editLockService.getActiveHolder('task', resolved.id);
    return {
      expiresAt: null,
      holderId: holder ?? null,
      lockedByOther: Boolean(holder) && holder !== ctx.userId,
    };
  }),

  releaseTaskLock: taskProcedureWrite.input(idInput).mutation(async ({ ctx, input }) => {
    if (!ctx.workspaceId) return;
    const resolved = await resolveOrThrow(ctx.taskModel, input.id);
    // Only broadcast "unlocked" when we actually released our own lock — if the
    // lease expired and another member took over, the lock is still held.
    const released = await ctx.editLockService.release('task', resolved.id);
    if (!released) return;
    void publishResourceEvent(
      { id: resolved.id, type: 'task' },
      { actorId: ctx.userId, data: { holderId: null }, type: 'lock.changed' },
    );
  }),

  updateConfig: taskProcedureWrite
    .input(idInput.merge(z.object({ config: z.record(z.string(), z.unknown()) })))
    .mutation(async ({ input, ctx }) => {
      const { id, config } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveOrThrow(model, id);
        const task = await model.updateTaskConfig(resolved.id, config);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return { data: task, message: 'Config updated', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateConfig]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update task config',
        });
      }
    }),

  previewSubtaskLayers: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const plan = await ctx.taskService.previewSubtaskLayers(input.id);
      return { data: plan, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:previewSubtaskLayers]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to plan subtask layers',
      });
    }
  }),

  runReadySubtasks: taskProcedureWrite.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const result = await ctx.taskService.runReadySubtasks(input.id);
      return { data: result, success: result.failed.length === 0 };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:runReadySubtasks]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to run subtasks',
      });
    }
  }),

  updateStatus: taskProcedureWrite
    .input(
      z.object({
        error: z.string().optional(),
        id: z.string(),
        status: z.enum(TASK_STATUSES),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await ctx.taskService.updateStatus(input);
        const { task, unlocked, paused, checkpointTriggered, allSubtasksDone, parentTaskId } =
          result;
        return {
          data: task,
          message: `Task ${input.status}`,
          success: true,
          ...(unlocked.length > 0 && { unlocked }),
          ...(paused.length > 0 && { paused }),
          ...(checkpointTriggered && { checkpointTriggered: true }),
          ...(allSubtasksDone && { allSubtasksDone: true, parentTaskId }),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateStatus]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update status',
        });
      }
    }),

  transferTask: taskProcedureWrite
    .input(
      z.object({
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
        taskId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.taskModel.resolve(input.taskId);
      if (!task)
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Task not found',
        });

      if (ctx.workspaceId && task.createdByUserId !== ctx.userId) {
        const canOverride = await hasWorkspaceScopedPermission({
          action: 'AGENT_UPDATE',
          db: ctx.serverDB,
          scopes: ['ALL'],
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        if (!canOverride) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.OwnerOnly } },
            code: 'FORBIDDEN',
            message: 'Only workspace owners can transfer tasks created by others',
          });
        }
      }

      if (input.targetWorkspaceId === (ctx.workspaceId ?? null)) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.SameWorkspace } },
          code: 'BAD_REQUEST',
          message: 'Cannot transfer task to the same workspace',
        });
      }

      if (input.targetWorkspaceId) {
        const canWriteTarget = await hasWorkspaceScopedPermission({
          action: 'AGENT_UPDATE',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: input.targetWorkspaceId,
        });
        if (!canWriteTarget) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
            code: 'FORBIDDEN',
            message: 'No write access to target workspace',
          });
        }
      }

      return ctx.taskModel.transferTo(
        task.id,
        input.targetWorkspaceId,
        ctx.userId,
        input.targetVisibility,
      );
    }),

  copyTaskToWorkspace: taskProcedureWrite
    .input(
      z.object({
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
        taskId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.taskModel.resolve(input.taskId);
      if (!task)
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Task not found',
        });

      if (input.targetWorkspaceId) {
        const canWriteTarget = await hasWorkspaceScopedPermission({
          action: 'AGENT_UPDATE',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: input.targetWorkspaceId,
        });
        if (!canWriteTarget) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
            code: 'FORBIDDEN',
            message: 'No write access to target workspace',
          });
        }
      }

      return ctx.taskModel.copyToWorkspace(
        task.id,
        input.targetWorkspaceId,
        ctx.userId,
        input.targetVisibility,
      );
    }),
});
