// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildPendingToolCalls,
  journalRecordsToEventSummaries,
  persistInterventionRequest,
  persistInterventionResolve,
} from './protocolRecovery';

const mockRequestIntervention = vi.fn();
const mockResolveIntervention = vi.fn();

vi.mock('@/database/models/agentRuntimeProtocol', () => ({
  AgentRuntimeProtocolModel: vi.fn().mockImplementation(() => ({
    requestIntervention: mockRequestIntervention,
    resolveIntervention: mockResolveIntervention,
  })),
}));

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn().mockResolvedValue({}),
}));

describe('protocolRecovery helpers', () => {
  it('builds tool idempotency keys', () => {
    const calls = buildPendingToolCalls({
      operationId: 'op-1',
      stepId: 'step:1',
      toolCalls: [{ toolCallId: 'tc-1', name: 'read', arguments: '{}' }],
    });
    expect(calls[0]?.idempotencyKey).toBe('op-1:step:1:tc-1');
    expect(calls[0]?.status).toBe('pending');
  });

  it('summarizes journal records for replay consumers', () => {
    const summaries = journalRecordsToEventSummaries([
      {
        createdAt: new Date(1),
        eventId: 'e1',
        operationId: 'op',
        payload: {},
        sequence: 1,
        type: 'operation_started',
      },
    ]);
    expect(summaries).toEqual([{ eventId: 'e1', sequence: 1, type: 'operation_started' }]);
  });
});

describe('protocolRecovery intervention helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('persistInterventionRequest', () => {
    it('returns ok when model request succeeds', async () => {
      mockRequestIntervention.mockResolvedValueOnce({
        ok: true,
        created: true,
        status: 'pending',
      });

      const result = await persistInterventionRequest({
        db: {} as any,
        intervention: {
          createdAt: Date.now(),
          interventionId: 'approve:tc-1',
          operationId: 'op-1',
          request: { tool: {} },
          stepId: 'step:1',
          type: 'approval',
        },
      });

      expect(result).toEqual({ ok: true, created: true });
    });

    it('propagates model failure instead of swallowing', async () => {
      mockRequestIntervention.mockResolvedValueOnce({ ok: false, error: 'insert_failed' });

      const result = await persistInterventionRequest({
        db: {} as any,
        intervention: {
          createdAt: Date.now(),
          interventionId: 'approve:tc-1',
          operationId: 'op-1',
          request: {},
          stepId: 'step:1',
          type: 'approval',
        },
      });

      expect(result).toEqual({ ok: false, error: 'insert_failed' });
    });

    it('returns ok:false on thrown db error (does not swallow silently)', async () => {
      mockRequestIntervention.mockRejectedValueOnce(new Error('connection lost'));

      const result = await persistInterventionRequest({
        db: {} as any,
        intervention: {
          createdAt: Date.now(),
          interventionId: 'approve:tc-1',
          operationId: 'op-1',
          request: {},
          stepId: 'step:1',
          type: 'approval',
        },
      });

      expect(result).toEqual({ ok: false, error: 'connection lost' });
    });
  });

  describe('persistInterventionResolve', () => {
    it('returns not_found when model says so', async () => {
      mockResolveIntervention.mockResolvedValueOnce({ ok: false, error: 'not_found' });

      const result = await persistInterventionResolve({
        commandId: 'cmd-1',
        db: {} as any,
        interventionId: 'approve:tc-1',
        operationId: 'op-1',
        resolution: { decision: 'approved' },
      });

      expect(result).toEqual({ ok: false, duplicate: false, error: 'not_found' });
    });
  });
});
