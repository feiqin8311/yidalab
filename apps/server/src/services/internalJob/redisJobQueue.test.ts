// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetRedisJobQueueForTests, RedisJobQueue } from './redisJobQueue';

/**
 * Minimal in-memory Redis stand-in covering the commands RedisJobQueue uses.
 * Keeps tests hermetic without a live Redis process.
 */
class FakeRedis {
  private store = new Map<string, string>();
  private lists = new Map<string, string[]>();
  private zsets = new Map<string, Map<string, number>>();

  async set(key: string, value: string, ..._args: unknown[]) {
    this.store.set(key, value);
    return 'OK';
  }

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async del(...keys: string[]) {
    for (const k of keys) {
      this.store.delete(k);
      this.lists.delete(k);
      this.zsets.delete(k);
    }
    return keys.length;
  }

  async exists(key: string) {
    return this.store.has(key) || this.lists.has(key) || this.zsets.has(key) ? 1 : 0;
  }

  async lpush(key: string, ...values: string[]) {
    const list = this.lists.get(key) ?? [];
    list.unshift(...values);
    this.lists.set(key, list);
    return list.length;
  }

  async brpop(key: string, _timeout: number) {
    const list = this.lists.get(key) ?? [];
    if (list.length === 0) {
      await new Promise((r) => setTimeout(r, 15));
      return null;
    }
    const v = list.pop()!;
    this.lists.set(key, list);
    return [key, v] as [string, string];
  }

  async lrem(key: string, _count: number, value: string) {
    const list = this.lists.get(key) ?? [];
    const next = list.filter((x) => x !== value);
    this.lists.set(key, next);
    return list.length - next.length;
  }

  async zadd(key: string, score: number, member: string) {
    const z = this.zsets.get(key) ?? new Map();
    z.set(member, score);
    this.zsets.set(key, z);
    return 1;
  }

  async zrem(key: string, member: string) {
    const z = this.zsets.get(key);
    if (!z?.has(member)) return 0;
    z.delete(member);
    return 1;
  }

  async zrangebyscore(key: string, min: number, max: number, ..._rest: unknown[]) {
    const z = this.zsets.get(key) ?? new Map();
    return [...z.entries()]
      .filter(([, s]) => s >= min && s <= max)
      .sort((a, b) => a[1] - b[1])
      .map(([m]) => m);
  }

  multi() {
    const ops: Array<() => Promise<unknown>> = [];
    const chain = {
      zrem: (key: string, member: string) => {
        ops.push(() => this.zrem(key, member));
        return chain;
      },
      lpush: (key: string, value: string) => {
        ops.push(() => this.lpush(key, value));
        return chain;
      },
      exec: async () => {
        const results = [];
        for (const op of ops) results.push([null, await op()]);
        return results;
      },
    };
    return chain;
  }

  async ping() {
    return 'PONG';
  }
}

describe('RedisJobQueue', () => {
  beforeEach(async () => {
    await __resetRedisJobQueueForTests();
  });

  afterEach(async () => {
    await __resetRedisJobQueueForTests();
  });

  it('runs a registered job', async () => {
    const redis = new FakeRedis() as any;
    const queue = new RedisJobQueue(redis, { concurrency: 1 });
    const seen: unknown[] = [];

    queue.register('test.job', async (payload) => {
      seen.push(payload);
    });
    queue.start();

    await queue.enqueue({ name: 'test.job', payload: { hello: 1 } });

    await vi.waitFor(() => expect(seen).toEqual([{ hello: 1 }]), { timeout: 3000 });
    await queue.stop();
  });

  it('cancels a delayed job before it runs', async () => {
    const redis = new FakeRedis() as any;
    const queue = new RedisJobQueue(redis, { concurrency: 1 });
    let ran = false;
    queue.register('test.delay', async () => {
      ran = true;
    });
    queue.start();

    const id = await queue.enqueue({
      delayMs: 5000,
      name: 'test.delay',
      payload: {},
    });
    await queue.cancel(id);
    await new Promise((r) => setTimeout(r, 200));
    expect(ran).toBe(false);
    await queue.stop();
  });
});
