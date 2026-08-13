import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { finalizeInactiveBotOperation } from '@/server/services/agentRuntime/stuckOperationWatchdog';

import { enqueueInternalJob } from './enqueue';
import { handleBotDeadlineJob } from './handlers';
import { JOB_NAMES } from './types';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/server/services/agentRuntime/stuckOperationWatchdog', () => ({
  finalizeInactiveBotOperation: vi.fn(),
}));
vi.mock('./enqueue', () => ({ enqueueInternalJob: vi.fn() }));

describe('handleBotDeadlineJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDB).mockResolvedValue({} as never);
  });

  it('reschedules the deadline for a bot operation with recent activity', async () => {
    const payload = { operationId: 'op-active' };
    vi.mocked(finalizeInactiveBotOperation).mockResolvedValue({
      abandoned: false,
      retryAfterMs: 710_000,
      status: 'active',
    });

    await handleBotDeadlineJob(payload);

    expect(finalizeInactiveBotOperation).toHaveBeenCalledWith({}, 'op-active');
    expect(enqueueInternalJob).toHaveBeenCalledWith({
      delayMs: 710_000,
      maxAttempts: 1,
      name: JOB_NAMES.botDeadline,
      payload,
    });
  });

  it('does not reschedule an operation that is already terminal or abandoned', async () => {
    vi.mocked(finalizeInactiveBotOperation).mockResolvedValue({
      abandoned: true,
      status: 'abandoned',
    });

    await handleBotDeadlineJob({ operationId: 'op-stale' });

    expect(enqueueInternalJob).not.toHaveBeenCalled();
  });
});
