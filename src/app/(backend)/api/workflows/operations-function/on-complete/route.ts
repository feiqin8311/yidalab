import debug from 'debug';
import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/server';
import { OperationsFunctionService } from '@/server/services/operationsFunction';

const log = debug('lobe-server:workflows:ops-on-complete');

type Payload = {
  errorMessage?: string;
  lastAssistantContent?: string;
  operationId?: string;
  reason?: string;
  runId?: string;
  userId?: string;
  workspaceId?: string;
};

/**
 * Plain POST (not Upstash Workflow serve).
 * Queue-mode onComplete is preferably delivered via internal job
 * (`ops.function.on-complete`); this route remains a fetch fallback without
 * QStash signature verification.
 */
export const POST = async (req: Request) => {
  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', success: false }, { status: 400 });
  }

  const { runId, userId, workspaceId, operationId, reason, errorMessage, lastAssistantContent } =
    payload;

  log('on-complete runId=%s reason=%s', runId, reason);

  if (!runId || !userId || !workspaceId) {
    return NextResponse.json(
      { error: 'Missing runId/userId/workspaceId', success: false },
      { status: 400 },
    );
  }

  try {
    const db = await getServerDB();
    const service = new OperationsFunctionService(db, userId, workspaceId);
    const result = await service.completeFromOperation({
      errorMessage,
      force: true,
      lastAssistantContent,
      operationId,
      reason,
      runId,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    log('on-complete failed: %O', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'complete failed',
        success: false,
      },
      { status: 500 },
    );
  }
};
