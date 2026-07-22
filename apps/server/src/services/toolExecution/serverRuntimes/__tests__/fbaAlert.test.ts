import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fbaAlertRuntime } from '../fbaAlert';

const runPersonalFbaAlert = vi.fn();

vi.mock('@/server/services/fbaAlert', () => ({
  runPersonalFbaAlert: (...args: unknown[]) => runPersonalFbaAlert(...args),
}));

describe('fbaAlertRuntime', () => {
  beforeEach(() => {
    runPersonalFbaAlert.mockReset();
  });

  it('rejects invalid scope', async () => {
    const runtime = fbaAlertRuntime.factory({
      agentId: 'agt_1',
      serverDB: {} as any,
      toolManifestMap: {},
      userId: 'user_1',
    });
    const result = await runtime.runFbaAlert({ scope: 'mars' });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_SCOPE');
    expect(runPersonalFbaAlert).not.toHaveBeenCalled();
  });

  it('calls runPersonalFbaAlert with scope and botContext', async () => {
    runPersonalFbaAlert.mockResolvedValue({
      identitySource: 'dingtalk_sender',
      job: {
        job_id: 'j1',
        result: { alert_count: 3, fetched_count: 10, report_path: 'r.xlsx', sid_distribution: {} },
        status: 'done',
      },
    });

    const botContext = {
      applicationId: 'app',
      isOwner: false,
      platform: 'dingtalk',
      platformThreadId: 't',
      senderExternalUserId: 'sender-1',
    };

    const runtime = fbaAlertRuntime.factory({
      agentId: 'agt_1',
      botContext,
      serverDB: {} as any,
      toolManifestMap: {},
      userId: 'user_1',
      workspaceId: 'ws_1',
    });

    const result = await runtime.runFbaAlert({ scope: 'us' });
    expect(result.success).toBe(true);
    expect(runPersonalFbaAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_1',
        botContext,
        mode: 'self',
        scope: 'us',
        userId: 'user_1',
        wait: true,
        workspaceId: 'ws_1',
      }),
    );
    expect(result.content).toContain('"alert_count": 3');
    expect(result.content).toContain('dingtalk_sender');
  });
});
