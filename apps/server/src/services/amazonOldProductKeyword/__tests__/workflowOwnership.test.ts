/**
 * Pure ownership check used by Upstash workflow entry — extracted logic test.
 */
import { describe, expect, it } from 'vitest';

const assertOwnership = (
  run: { userId: string; workspaceId: string } | null | undefined,
  userId: string,
  workspaceId: string,
) => {
  if (!run) throw new Error('RUN_NOT_FOUND');
  if (run.userId !== userId || run.workspaceId !== workspaceId) {
    throw new Error('WORKFLOW_PAYLOAD_MISMATCH');
  }
  return { ok: true as const };
};

describe('workflow ownership assert', () => {
  it('accepts matching payload', () => {
    expect(assertOwnership({ userId: 'u1', workspaceId: 'w1' }, 'u1', 'w1')).toEqual({ ok: true });
  });

  it('rejects missing run', () => {
    expect(() => assertOwnership(null, 'u1', 'w1')).toThrow('RUN_NOT_FOUND');
  });

  it('rejects user mismatch', () => {
    expect(() => assertOwnership({ userId: 'u1', workspaceId: 'w1' }, 'u2', 'w1')).toThrow(
      'WORKFLOW_PAYLOAD_MISMATCH',
    );
  });

  it('rejects workspace mismatch', () => {
    expect(() => assertOwnership({ userId: 'u1', workspaceId: 'w1' }, 'u1', 'w2')).toThrow(
      'WORKFLOW_PAYLOAD_MISMATCH',
    );
  });
});
