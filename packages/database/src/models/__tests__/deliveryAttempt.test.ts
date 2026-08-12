// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, deliveryAttempts, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DeliveryAttemptModel } from '../deliveryAttempt';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'delivery-attempt-test-user';
const operationId = 'op-delivery-1';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB.insert(agentOperations).values({
    id: operationId,
    status: 'running',
    userId,
  });
});

afterEach(async () => {
  await serverDB.delete(deliveryAttempts);
  await serverDB.delete(agentOperations);
  await serverDB.delete(users);
});

describe('DeliveryAttemptModel', () => {
  it('enqueues idempotently by dedupe key', async () => {
    const model = new DeliveryAttemptModel(serverDB, userId);
    const dedupeKey = `${operationId}:dingpan-report:default:report`;

    const a = await model.enqueue({
      dedupeKey,
      deliveryType: 'dingpan-report',
      operationId,
    });
    const b = await model.enqueue({
      dedupeKey,
      deliveryType: 'dingpan-report',
      operationId,
    });

    expect(a.id).toBe(b.id);
    expect(a.status).toBe('pending');
  });

  it('claims, succeeds with verification, and is not re-claimable', async () => {
    const model = new DeliveryAttemptModel(serverDB, userId);
    const dedupeKey = `${operationId}:dingpan-report:default:report`;
    const row = await model.enqueue({
      dedupeKey,
      deliveryType: 'dingpan-report',
      operationId,
    });

    const claimed = await model.tryClaim(row.id, { claimToken: 'tok1', claimedBy: 'test' });
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempt).toBe(1);

    const previewUrl =
      'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=2&type=file';
    const done = await model.markSucceeded(row.id, {
      claimToken: 'tok1',
      fileId: '2',
      previewUrl,
      spaceId: '1',
      verificationStatus: 'verified',
    });
    expect(done?.status).toBe('succeeded');
    expect(done?.verificationStatus).toBe('verified');
    expect(done?.previewUrl).toBe(previewUrl);

    const reclaimed = await model.tryClaim(row.id, { claimToken: 'tok2' });
    expect(reclaimed).toBeNull();

    const found = await model.findSuccessfulByOperation(operationId, 'dingpan-report');
    expect(found?.id).toBe(row.id);
  });

  it('marks failed with retryable backoff fields', async () => {
    const model = new DeliveryAttemptModel(serverDB, userId);
    const row = await model.enqueue({
      dedupeKey: `${operationId}:dingpan-report:default:report`,
      deliveryType: 'dingpan-report',
      operationId,
    });
    await model.tryClaim(row.id, { claimToken: 't' });
    const failed = await model.markFailed(row.id, {
      claimToken: 't',
      errorCode: 'dingpan_upload_failed',
      errorMessage: '403',
      nextAttemptAt: new Date(Date.now() + 5000),
      retryable: true,
    });
    expect(failed?.status).toBe('failed');
    expect(failed?.retryable).toBe(true);
    expect(failed?.errorCode).toBe('dingpan_upload_failed');
  });

  it('CAS: stale claimToken cannot overwrite a new worker success', async () => {
    const model = new DeliveryAttemptModel(serverDB, userId);
    const row = await model.enqueue({
      dedupeKey: `${operationId}:dingpan-report:default:report`,
      deliveryType: 'dingpan-report',
      operationId,
    });

    const oldClaim = await model.tryClaim(row.id, {
      claimToken: 'old-tok',
      leaseMs: 1,
    });
    expect(oldClaim?.status).toBe('running');

    // Expire lease so a new worker can reclaim.
    await new Promise((r) => setTimeout(r, 5));
    const newClaim = await model.tryClaim(row.id, {
      claimToken: 'new-tok',
      leaseMs: 120_000,
    });
    expect(newClaim?.status).toBe('running');
    expect(newClaim?.claimToken).toBe('new-tok');

    const previewUrl =
      'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=2&type=file';
    const done = await model.markSucceeded(row.id, {
      claimToken: 'new-tok',
      previewUrl,
      verificationStatus: 'verified',
    });
    expect(done?.status).toBe('succeeded');

    // Stale worker tries to mark failed with old token — must no-op.
    const stale = await model.markFailed(row.id, {
      claimToken: 'old-tok',
      errorCode: 'stale',
      errorMessage: 'should not win',
      retryable: true,
    });
    expect(stale).toBeNull();

    const found = await model.findSuccessfulByOperation(operationId, 'dingpan-report');
    expect(found?.status).toBe('succeeded');
    expect(found?.previewUrl).toBe(previewUrl);
    expect(found?.errorCode).toBeNull();
  });

  it('CAS: markSucceeded without matching claimToken no-ops when running under another claim', async () => {
    const model = new DeliveryAttemptModel(serverDB, userId);
    const row = await model.enqueue({
      dedupeKey: `${operationId}:dingpan-report:default:report`,
      deliveryType: 'dingpan-report',
      operationId,
    });
    await model.tryClaim(row.id, { claimToken: 'holder' });
    const lost = await model.markSucceeded(row.id, {
      claimToken: 'wrong',
      previewUrl:
        'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=2&type=file',
    });
    expect(lost).toBeNull();
  });

  it('CAS: no-token / empty token cannot fail a running claim', async () => {
    const model = new DeliveryAttemptModel(serverDB, userId);
    const row = await model.enqueue({
      dedupeKey: `${operationId}:dingpan-report:default:report`,
      deliveryType: 'dingpan-report',
      operationId,
    });
    await model.tryClaim(row.id, { claimToken: 'new' });

    // Empty claimToken must no-op at runtime (CAS fence).
    const stale = await model.markFailed(row.id, {
      claimToken: '',
      errorCode: 'no-token-stale',
      errorMessage: 'should not win',
      retryable: true,
    });
    expect(stale).toBeNull();

    const still = await model.findById(row.id);
    expect(still?.status).toBe('running');
    expect(still?.claimToken).toBe('new');
  });
});
