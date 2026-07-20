import type { Context } from 'hono';
import { Hono } from 'hono';

import { enqueueInternalJob } from '@/server/services/internalJob/enqueue';
import { JOB_NAMES } from '@/server/services/internalJob/types';

import { qstashAuth } from '../middlewares/qstashAuth';

/**
 * Memory extraction HTTP bridges.
 *
 * Previously these routes used Upstash Workflow `serve()` which constructed a
 * QStash client at module load (noisy without QSTASH_TOKEN). Triggers now go
 * through Redis internal jobs — same paths kept for cron / ops HTTP callers.
 */
const app = new Hono();

const enqueueJson = (name: string) => async (c: Context) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const jobId = await enqueueInternalJob({ name, payload: body ?? {} });
    return c.json({ jobId, ok: true });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to enqueue job', ok: false },
      500,
    );
  }
};

app.post('/call-cron-hourly-analysis', qstashAuth(), enqueueJson(JOB_NAMES.memoryHourly));
app.post(
  '/pipelines/persona/update-writing',
  qstashAuth(),
  enqueueJson(JOB_NAMES.memoryPersonaUpdate),
);
app.post(
  '/pipelines/chat-topic/process-users',
  qstashAuth(),
  enqueueJson(JOB_NAMES.memoryProcessUsers),
);
app.post(
  '/pipelines/chat-topic/process-user-topics',
  qstashAuth(),
  enqueueJson(JOB_NAMES.memoryProcessUserTopics),
);
app.post(
  '/pipelines/chat-topic/process-topics',
  qstashAuth(),
  enqueueJson(JOB_NAMES.memoryProcessTopics),
);
app.post(
  '/pipelines/chat-topic/process-topic',
  qstashAuth(),
  enqueueJson(JOB_NAMES.memoryProcessTopic),
);

export default app;
