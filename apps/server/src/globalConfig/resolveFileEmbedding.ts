import { DEFAULT_FILE_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { FilesConfigItem, UserServiceModelConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';

import { getServerDefaultFilesConfig } from './index';

/**
 * Resolve the embedding model used for resource / knowledge-base file vectors.
 *
 * Priority:
 * 1. User setting `systemAgent.fileEmbedding` (Service Model page)
 * 2. Server env `DEFAULT_FILES_CONFIG` embedding_model
 * 3. Built-in default (openai / text-embedding-3-small)
 */
export const resolveFileEmbeddingModel = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<FilesConfigItem> => {
  try {
    const settings = await new UserModel(db, userId).getUserSettings();
    const systemAgent = settings?.systemAgent as Partial<UserServiceModelConfig> | null | undefined;
    const fromUser = systemAgent?.fileEmbedding;
    if (fromUser?.model && fromUser?.provider) {
      return { model: fromUser.model, provider: fromUser.provider };
    }
  } catch {
    // Fall through to server defaults if settings cannot be read.
  }

  return getServerDefaultFilesConfig().embeddingModel || DEFAULT_FILE_EMBEDDING_MODEL_ITEM;
};
