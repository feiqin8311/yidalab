import type { LobeChatDatabase } from '@lobechat/database';
import type { ChatTopicBotContext } from '@lobechat/types';

import { AgentBotProviderModel } from '@/database/models/agentBotProvider';

import { FbaAlertClient, type FbaAlertJob, type FbaAlertMode } from './client';
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
  scope: string;
  serverDB: LobeChatDatabase;
  userId: string;
  wait?: boolean;
  workspaceId?: string;
}

/**
 * Personal pull path: resolve notify user ids by entry, POST fba-bot API.
 * Never accepts LLM-supplied notify_user_ids.
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

  const mode = params.mode ?? 'self';
  if (mode === 'self' && identity.source === 'none') {
    throw new Error(identity.reason ?? 'Cannot resolve DingTalk notify user id');
  }

  const job = await client.runAlert({
    mode,
    notifyUserIds: mode === 'self' ? identity.notifyUserIds : undefined,
    scope: params.scope,
  });

  if (params.wait !== false && job.status !== 'done' && job.status !== 'failed') {
    const finished = await client.waitForJob(job.job_id);
    return { identitySource: identity.source, job: finished };
  }

  return { identitySource: identity.source, job };
};
