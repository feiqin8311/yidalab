import { AgentRuntimeErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveModelFailoverCandidates, shouldFailoverModel } from './modelFailover';

describe('modelFailover', () => {
  it('bounds, trims, and de-duplicates the automatic candidate chain', () => {
    expect(
      resolveModelFailoverCandidates({ model: 'primary', provider: 'provider-a' }, [
        { model: ' primary ', provider: 'provider-a' },
        { model: 'backup-1', provider: 'provider-b' },
        { model: 'backup-2', provider: 'provider-c' },
        { model: 'backup-3', provider: 'provider-d' },
        { model: 'backup-4', provider: 'provider-e' },
        { model: 'backup-5', provider: 'provider-f' },
        { model: 'ignored', provider: 'provider-g' },
      ]),
    ).toEqual([
      { model: 'primary', provider: 'provider-a' },
      { model: 'backup-1', provider: 'provider-b' },
      { model: 'backup-2', provider: 'provider-c' },
      { model: 'backup-3', provider: 'provider-d' },
      { model: 'backup-4', provider: 'provider-e' },
      { model: 'backup-5', provider: 'provider-f' },
    ]);
  });

  it('rotates the last healthy candidate to the front for later tool rounds', () => {
    expect(
      resolveModelFailoverCandidates(
        { model: 'primary', provider: 'provider-a' },
        [
          { model: 'backup-1', provider: 'provider-b' },
          { model: 'backup-2', provider: 'provider-c' },
        ],
        { model: 'backup-1', provider: 'provider-b' },
      ),
    ).toEqual([
      { model: 'backup-1', provider: 'provider-b' },
      { model: 'backup-2', provider: 'provider-c' },
      { model: 'primary', provider: 'provider-a' },
    ]);
  });

  it('allows transient and candidate-specific terminal errors but not policy failures', () => {
    expect(shouldFailoverModel({ kind: 'retry', message: 'timeout' })).toBe(true);
    expect(
      shouldFailoverModel({
        code: AgentRuntimeErrorType.InvalidProviderAPIKey,
        kind: 'stop',
        message: 'invalid key',
      }),
    ).toBe(true);
    expect(
      shouldFailoverModel({
        code: AgentRuntimeErrorType.ContentModeration,
        kind: 'stop',
        message: 'blocked',
      }),
    ).toBe(false);
  });
});
