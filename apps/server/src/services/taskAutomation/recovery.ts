import debug from 'debug';
import { eq } from 'drizzle-orm';

import { TaskAutomationModel } from '@/database/models/taskAutomation';
import { agentOperations } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { shouldV2Dispatch } from './mode';

const log = debug('task-automation:recovery');

export interface RecoveryResult {
  rebound: number;
  released: number;
  scanned: number;
}

/**
 * Recovery: expired claims.
 * - If agent_operations already exists for the attempt's idempotency key,
 *   rebind operationId and keep observing (do NOT start a new agent).
 * - Otherwise release claim and re-pend the run for a new attempt.
 * Active in on + drain.
 */
export async function recoverExpiredAutomationClaims(
  db: LobeChatDatabase,
  options: { limit?: number } = {},
): Promise<RecoveryResult> {
  if (!shouldV2Dispatch()) {
    return { rebound: 0, released: 0, scanned: 0 };
  }

  const model = new TaskAutomationModel(db);
  const expired = await model.listExpiredAttempts(options.limit ?? 50);

  let rebound = 0;
  let released = 0;

  for (const attempt of expired) {
    // Global lookup by idempotency key (no user filter — recovery is system-level).
    const [existingOp] = await db
      .select({ id: agentOperations.id, topicId: agentOperations.topicId })
      .from(agentOperations)
      .where(eq(agentOperations.idempotencyKey, attempt.operationIdempotencyKey))
      .limit(1);

    if (attempt.operationId || existingOp) {
      const opId = attempt.operationId ?? existingOp!.id;
      if (!attempt.operationId && existingOp) {
        await model.bindOperation({
          attemptId: attempt.id,
          claimToken: attempt.claimToken ?? '',
          operationId: opId,
          topicId: existingOp.topicId,
        });
        rebound += 1;
        log('rebound attempt=%s op=%s', attempt.id, opId);
      }
      // Operation exists — do not start another; completion hook will finish.
      continue;
    }

    const result = await model.releaseExpiredAttempt(attempt.id);
    if (!result) continue;

    if (result.hasOperation) {
      rebound += 1;
    } else {
      released += 1;
      log('released expired claim attempt=%s run=%s', attempt.id, result.run.id);
    }
  }

  log('recovery: scanned=%d rebound=%d released=%d', expired.length, rebound, released);
  return { rebound, released, scanned: expired.length };
}
