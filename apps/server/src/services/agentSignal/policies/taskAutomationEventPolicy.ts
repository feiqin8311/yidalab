import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import debug from 'debug';

import { getServerDB } from '@/database/server';

import { defineAgentSignalHandlers, defineSourceHandler } from '../runtime/middleware';

const log = debug('lobe-server:task-automation-event-policy');

const LISTEN = [
  AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted,
  AGENT_SIGNAL_SOURCE_TYPES.agentExecutionFailed,
  AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted,
  AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed,
  AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged,
] as const;

/**
 * Fan product-relevant Agent Signal sources into the task automation event ingress.
 * Failures are non-fatal — must never break the signal pipeline.
 */
export const createTaskAutomationEventPolicy = () =>
  defineAgentSignalHandlers([
    defineSourceHandler([...LISTEN], 'task.automation.event-ingress', async (source) => {
      try {
        const { ingestAutomationEvent } =
          await import('@/server/services/taskAutomation/eventIngress');
        const db = await getServerDB();
        const payload = source.payload as Record<string, unknown>;
        const sourceEventId =
          (payload.sourceEventId as string | undefined) ||
          (payload.eventId as string | undefined) ||
          source.id ||
          `${source.sourceType}:${payload.operationId ?? ''}:${Date.now()}`;

        const result = await ingestAutomationEvent(db, {
          meta: {
            agentId: payload.agentId,
            applicationId: payload.applicationId,
            identifier: payload.identifier,
            platform: payload.platform,
            status: payload.status,
            taskId: payload.taskId,
            toolName: payload.toolName,
          },
          operationId: payload.operationId as string | undefined,
          sourceEventId: String(sourceEventId),
          sourceType: source.sourceType,
          userId: (payload.userId as string | undefined) ?? source.userId,
          workspaceId: (payload.workspaceId as string | undefined) ?? source.workspaceId,
        });

        if (result.planned > 0) {
          log('planned %d automation run(s) from %s', result.planned, source.sourceType);
        }
      } catch (error) {
        log('event ingress failed (non-fatal): %O', error);
      }
    }),
  ]);
