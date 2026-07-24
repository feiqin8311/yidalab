import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runPersonalFbaAlert } from './runPersonalFbaAlert';

const runAlert = vi.fn();
const waitForJob = vi.fn();
const fromEnv = vi.fn();

vi.mock('./client', () => ({
  FbaAlertClient: {
    fromEnv: () => fromEnv(),
  },
}));

vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: class {
    query = async () => [];
  },
}));

describe('runPersonalFbaAlert rate-limit retry', () => {
  beforeEach(() => {
    runAlert.mockReset();
    waitForJob.mockReset();
    fromEnv.mockReset();
    fromEnv.mockReturnValue({ runAlert, waitForJob });
  });

  it('waits and retries when job fails with lingxing 3001008, then succeeds', async () => {
    const sleep = vi.fn(async () => {});
    runAlert
      .mockResolvedValueOnce({ job_id: 'j1', status: 'queued' })
      .mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    waitForJob
      .mockResolvedValueOnce({
        error:
          "领星接口返回失败: {'code': '3001008', 'msg': 'new requests too frequently. please request later.'}",
        job_id: 'j1',
        status: 'failed',
      })
      .mockResolvedValueOnce({
        job_id: 'j2',
        result: { alert_count: 1, fetched_count: 2, report_path: 'x', sid_distribution: {} },
        status: 'done',
      });

    const result = await runPersonalFbaAlert({
      agentId: 'agt',
      botContext: {
        applicationId: 'a',
        isOwner: false,
        platform: 'dingtalk',
        platformThreadId: 't',
        senderExternalUserId: 'u1',
      },
      mode: 'self',
      rateLimitRetryWaitsMs: [100, 200],
      scope: 'ezarc',
      serverDB: {} as any,
      sleep,
      userId: 'user_1',
      wait: true,
    });

    expect(result.job.status).toBe('done');
    expect(runAlert).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);
    expect(result.job.job_id).toBe('j2');
  });

  it('returns last failed job after retries exhausted', async () => {
    const sleep = vi.fn(async () => {});
    runAlert.mockResolvedValue({ job_id: 'j', status: 'queued' });
    waitForJob.mockResolvedValue({
      error: '3001008 too frequently',
      job_id: 'j',
      status: 'failed',
    });

    const result = await runPersonalFbaAlert({
      agentId: 'agt',
      botContext: {
        applicationId: 'a',
        isOwner: false,
        platform: 'dingtalk',
        platformThreadId: 't',
        senderExternalUserId: 'u1',
      },
      mode: 'self',
      rateLimitRetryWaitsMs: [10],
      scope: 'ezarc',
      serverDB: {} as any,
      sleep,
      userId: 'user_1',
    });

    expect(result.job.status).toBe('failed');
    expect(runAlert).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
