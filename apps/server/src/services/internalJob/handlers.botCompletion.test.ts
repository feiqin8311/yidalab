// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisSet = vi.fn();
const redisDel = vi.fn();
const handleCallback = vi.fn();

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => ({ del: redisDel, set: redisSet }),
}));

vi.mock('@/server/services/taskRunner/heartbeatTick', () => ({
  runHeartbeatTick: vi.fn(),
}));

vi.mock('@/server/services/taskRunner/scheduleTick', () => ({
  runScheduleTick: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/server/services/bot/BotCallbackService', () => ({
  BotCallbackService: vi.fn().mockImplementation(() => ({ handleCallback })),
}));

const { handleBotCompletionJob } = await import('./handlers');

describe('handleBotCompletionJob', () => {
  beforeEach(() => {
    redisSet.mockReset();
    redisDel.mockReset();
    handleCallback.mockReset();
    redisSet.mockResolvedValue('OK');
    redisDel.mockResolvedValue(1);
    handleCallback.mockResolvedValue(undefined);
  });

  it('releases the sent mark so a failed callback can retry', async () => {
    handleCallback.mockRejectedValue(new Error('dingtalk down'));

    await expect(
      handleBotCompletionJob({
        applicationId: 'app-1',
        operationId: 'op-1',
        platformThreadId: 'thread-1',
      }),
    ).rejects.toThrow('dingtalk down');

    expect(redisSet).toHaveBeenCalledWith('bot-completion:sent:op-1', '1', 'EX', 7 * 86_400, 'NX');
    expect(redisDel).toHaveBeenCalledWith('bot-completion:sent:op-1');
  });

  it('keeps the sent mark after a successful callback', async () => {
    await handleBotCompletionJob({
      applicationId: 'app-1',
      operationId: 'op-1',
      platformThreadId: 'thread-1',
    });

    expect(handleCallback).toHaveBeenCalledTimes(1);
    expect(redisDel).not.toHaveBeenCalled();
  });
});
