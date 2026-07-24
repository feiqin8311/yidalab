import type { LobeChatDatabase } from '@lobechat/database';
import type { ChatTopicBotContext } from '@lobechat/types';

import { AgentBotProviderModel } from '@/database/models/agentBotProvider';

import { FbaAlertClient, type FbaAlertJob, type FbaAlertMode } from './client';
import { DEFAULT_FBA_RATE_LIMIT_WAITS_MS, isFbaRateLimitError, sleepMs } from './rateLimit';
import { resolveFbaNotifyUserIds } from './resolveNotifyUserIds';

/**
 * Read Owner DingTalk userId from the agent's DingTalk message channel
 * advanced settings (`settings.userId`).
 */
export const loadDingTalkChannelOwnerUserId = async (params: {
  agentId: string;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}): Promise<string | undefined> => {
  const model = new AgentBotProviderModel(
    params.serverDB,
    params.userId,
    undefined,
    params.workspaceId,
  );
  const rows = await model.query({ agentId: params.agentId, platform: 'dingtalk' });
  for (const row of rows) {
    const settings = row.settings as Record<string, unknown> | null | undefined;
    const userId = typeof settings?.userId === 'string' ? settings.userId.trim() : '';
    if (userId) return userId;
  }
  return undefined;
};

export interface RunPersonalFbaAlertParams {
  agentId: string;
  botContext?: ChatTopicBotContext | null;
  mode?: Extract<FbaAlertMode, 'self' | 'dry_run' | 'upload_only'>;
  /**
   * Waits between rate-limit retries (ms). Default 30s / 60s / 90s.
   * Pass `[]` to disable retries (tests / one-shot).
   */
  rateLimitRetryWaitsMs?: readonly number[];
  scope: string;
  serverDB: LobeChatDatabase;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  userId: string;
  wait?: boolean;
  workspaceId?: string;
}

/**
 * Personal pull path: resolve notify user ids by entry, POST fba-bot API.
 * Never accepts LLM-supplied notify_user_ids.
 *
 * On Lingxing rate-limit (e.g. 3001008 / too frequently), waits and re-runs the
 * job instead of immediately failing the agent tool.
 */
export const runPersonalFbaAlert = async (
  params: RunPersonalFbaAlertParams,
): Promise<{ identitySource: string; job: FbaAlertJob }> => {
  const client = FbaAlertClient.fromEnv();
  if (!client) {
    throw new Error(
      'FBA_ALERT_API_URL / FBA_ALERT_API_TOKEN are not configured on the YidaLab server',
    );
  }

  const channelOwnerUserId = await loadDingTalkChannelOwnerUserId({
    agentId: params.agentId,
    serverDB: params.serverDB,
    userId: params.userId,
    workspaceId: params.workspaceId,
  });

  const identity = resolveFbaNotifyUserIds({
    botContext: params.botContext,
    channelOwnerUserId,
  });

  // YidaLab chat/Web default: upload dingpan only, return preview_url in job result
  // (no robot private message). Explicit `self` still requires notify identity.
  const mode = params.mode ?? 'upload_only';
  if (mode === 'self' && identity.source === 'none') {
    throw new Error(identity.reason ?? 'Cannot resolve DingTalk notify user id');
  }

  const waits = params.rateLimitRetryWaitsMs ?? DEFAULT_FBA_RATE_LIMIT_WAITS_MS;
  const sleep = params.sleep ?? sleepMs;
  const maxAttempts = waits.length + 1;

  let lastJob: FbaAlertJob | undefined;
  let lastError: string | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const waitMs = waits[attempt - 1] ?? waits.at(-1) ?? 30_000;
      await sleep(waitMs);
    }

    try {
      const job = await client.runAlert({
        mode,
        notifyUserIds: mode === 'self' ? identity.notifyUserIds : undefined,
        scope: params.scope,
      });

      const finished =
        params.wait !== false && job.status !== 'done' && job.status !== 'failed'
          ? await client.waitForJob(job.job_id)
          : job;

      lastJob = finished;

      if (finished.status === 'failed' && isFbaRateLimitError(finished.error)) {
        lastError = finished.error ?? 'rate limited';
        continue;
      }

      return { identitySource: identity.source, job: finished };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isFbaRateLimitError(message) && attempt < maxAttempts - 1) {
        lastError = message;
        continue;
      }
      throw error;
    }
  }

  if (lastJob) {
    return { identitySource: identity.source, job: lastJob };
  }

  throw new Error(
    `FBA alert rate-limited after ${maxAttempts} attempts: ${lastError ?? 'unknown'}`,
  );
};
