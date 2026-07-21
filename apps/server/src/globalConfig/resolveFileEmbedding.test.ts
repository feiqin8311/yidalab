// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveFileEmbeddingModel } from './resolveFileEmbedding';

const getUserSettings = vi.fn();
const getServerDefaultFilesConfig = vi.fn();

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({ getUserSettings })),
}));

vi.mock('./index', () => ({
  getServerDefaultFilesConfig: (...args: unknown[]) => getServerDefaultFilesConfig(...args),
}));

describe('resolveFileEmbeddingModel', () => {
  const db = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    getServerDefaultFilesConfig.mockReturnValue({
      embeddingModel: { model: 'from-env', provider: 'env-provider' },
    });
  });

  it('prefers user systemAgent.fileEmbedding when set', async () => {
    getUserSettings.mockResolvedValue({
      systemAgent: {
        fileEmbedding: { model: 'Qwen/Qwen3-Embedding-0.6B', provider: 'siliconcloud' },
      },
    });

    await expect(resolveFileEmbeddingModel(db, 'user_1')).resolves.toEqual({
      model: 'Qwen/Qwen3-Embedding-0.6B',
      provider: 'siliconcloud',
    });
    expect(getServerDefaultFilesConfig).not.toHaveBeenCalled();
  });

  it('falls back to DEFAULT_FILES_CONFIG when user has no override', async () => {
    getUserSettings.mockResolvedValue({ systemAgent: {} });

    await expect(resolveFileEmbeddingModel(db, 'user_1')).resolves.toEqual({
      model: 'from-env',
      provider: 'env-provider',
    });
  });

  it('falls back to env when settings read fails', async () => {
    getUserSettings.mockRejectedValue(new Error('db down'));

    await expect(resolveFileEmbeddingModel(db, 'user_1')).resolves.toEqual({
      model: 'from-env',
      provider: 'env-provider',
    });
  });
});
