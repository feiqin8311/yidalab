import debug from 'debug';

import { enqueueInternalJob } from '@/server/services/internalJob/enqueue';
import { JOB_NAMES } from '@/server/services/internalJob/types';

import type { AgentSignalWorkflowRunPayload } from './types';

export type { AgentSignalWorkflowRunPayload, AgentSignalWorkflowSourceEventInput } from './types';

const log = debug('lobe-server:workflows:agent-signal');

/**
 * Agent Signal async trigger via internal Redis jobs (replaces Upstash Workflow).
 * Returns `{ workflowRunId }` for callers that previously stored QStash run ids.
 */
export class AgentSignalWorkflow {
  static async triggerRun(payload: AgentSignalWorkflowRunPayload) {
    log('Enqueue agent-signal run payload=%O', {
      agentId: payload.agentId,
      sourceEvent: payload.sourceEvent,
      userId: payload.userId,
    });

    const jobId = await enqueueInternalJob({
      // One active run per scope key (dedupe replaces unfinished job).
      dedupeKey: `agent-signal:${payload.sourceEvent.scopeKey}`,
      name: JOB_NAMES.agentSignalRun,
      payload,
    });

    return { workflowRunId: jobId };
  }
}
