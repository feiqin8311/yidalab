import { Hono } from 'hono';

import { enqueueInternalJob } from '@/server/services/internalJob/enqueue';
import { JOB_NAMES } from '@/server/services/internalJob/types';

import { qstashAuth } from '../middlewares/qstashAuth';
import { scheduleNightlyReview } from './handlers/scheduleNightlyReview';

/**
 * Agent Signal HTTP bridges (Redis internal jobs; no Upstash Workflow serve()).
 */
const app = new Hono();

app.post('/cron-hourly-nightly-self-review', qstashAuth(), scheduleNightlyReview);

app.post('/run', qstashAuth(), async (c) => {
  try {
    const body = await c.req.json();
    const scopeKey =
      body && typeof body === 'object' && body.sourceEvent?.scopeKey
        ? String(body.sourceEvent.scopeKey)
        : undefined;
    const jobId = await enqueueInternalJob({
      ...(scopeKey ? { dedupeKey: `agent-signal:${scopeKey}` } : {}),
      name: JOB_NAMES.agentSignalRun,
      payload: body,
    });
    return c.json({ jobId, ok: true, workflowRunId: jobId });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to enqueue agent-signal run' },
      500,
    );
  }
});

export default app;
