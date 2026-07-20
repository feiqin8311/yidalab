import { DingpanManifest, DingpanPersonalCredKey } from '@lobechat/builtin-tool-dingpan';
import { DingpanExecutionRuntime } from '@lobechat/builtin-tool-dingpan/executionRuntime';
import type { LobeChatDatabase } from '@lobechat/database';

import { UserCredentialModel } from '@/database/models/userCredential';

import { type ServerRuntimeRegistration } from './types';

const baseRuntime = new DingpanExecutionRuntime();

/**
 * Inject **personal** dingpan credential into process.env for this call.
 * Each user has their own folder path (DINGTALK_FOLDER_LINK etc.) under
 * personal credential key `dingtalk-dingpan`. Deploy/.env still wins if set.
 */
const withPersonalDingpanCredEnv = async <T>(
  userId: string | undefined,
  serverDB: LobeChatDatabase | undefined,
  fn: () => Promise<T>,
): Promise<T> => {
  if (!userId || !serverDB) return fn();

  try {
    const model = new UserCredentialModel(serverDB, userId);
    const personal = await model.listDecryptedKvEnv(null);

    // Prefer the dedicated dingpan credential; fall back to other personal kv-env keys.
    const dingpan = personal.find((b) => b.key === DingpanPersonalCredKey);
    const ordered = dingpan
      ? [dingpan, ...personal.filter((b) => b.key !== DingpanPersonalCredKey)]
      : personal;

    for (const bundle of ordered) {
      for (const [k, v] of Object.entries(bundle.values)) {
        if (!v?.trim()) continue;
        if (!process.env[k]?.trim()) process.env[k] = v;
      }
    }
  } catch {
    // Missing table / decrypt failure: still try with process env only.
  }

  return fn();
};

export const dingpanRuntime: ServerRuntimeRegistration = {
  factory: (context) => ({
    dingpanStatus: async (args: any) =>
      withPersonalDingpanCredEnv(context.userId, context.serverDB, () =>
        baseRuntime.dingpanStatus(args),
      ),
    uploadToDingpan: async (args: any) =>
      withPersonalDingpanCredEnv(context.userId, context.serverDB, () =>
        baseRuntime.uploadToDingpan(args),
      ),
  }),
  identifier: DingpanManifest.identifier,
};
