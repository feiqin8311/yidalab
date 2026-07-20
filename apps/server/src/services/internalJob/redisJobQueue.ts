import debug from 'debug';
import type Redis from 'ioredis';

import type { EnqueueOptions, JobHandler, JobRecord } from './types';

const createJobId = () =>
  `ij_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

const log = debug('lobe-server:internal-job');

const KEY = {
  cancel: (id: string) => `ij:cancel:${id}`,
  delayed: 'ij:delayed',
  dlq: 'ij:dlq',
  job: (id: string) => `ij:job:${id}`,
  ready: 'ij:ready',
} as const;

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_CONCURRENCY = 4;
const POLL_MS = 500;

/**
 * Minimal Redis-backed job queue (ready LIST + delayed ZSET).
 * Replaces QStash delay delivery for same-cluster workers.
 */
export class RedisJobQueue {
  private readonly redis: Redis;
  private readonly handlers = new Map<string, JobHandler>();
  private running = false;
  private workers: Promise<void>[] = [];
  private concurrency: number;

  constructor(redis: Redis, options?: { concurrency?: number }) {
    this.redis = redis;
    this.concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  }

  register(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  async enqueue(options: EnqueueOptions): Promise<string> {
    const id = options.dedupeKey ? `d:${options.dedupeKey}` : createJobId();
    const now = Date.now();
    const runAt = now + Math.max(0, options.delayMs ?? 0);
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    const record: JobRecord = {
      attempts: 0,
      id,
      maxAttempts,
      name: options.name,
      payload: options.payload,
      runAt,
    };

    await this.redis.set(KEY.job(id), JSON.stringify(record));
    await this.redis.del(KEY.cancel(id));

    if (runAt <= now) {
      await this.redis.lpush(KEY.ready, id);
    } else {
      await this.redis.zadd(KEY.delayed, runAt, id);
    }

    log('enqueued %s name=%s delayMs=%d', id, options.name, options.delayMs ?? 0);
    return id;
  }

  async cancel(jobId: string): Promise<void> {
    if (!jobId) return;
    await this.redis.set(KEY.cancel(jobId), '1', 'EX', 86_400);
    await this.redis.lrem(KEY.ready, 0, jobId);
    await this.redis.zrem(KEY.delayed, jobId);
    await this.redis.del(KEY.job(jobId));
    log('canceled %s', jobId);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.workers = Array.from({ length: this.concurrency }, (_, i) => this.workerLoop(i));
    void this.delayedPumpLoop();
    log('workers started concurrency=%d', this.concurrency);
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.allSettled(this.workers);
    this.workers = [];
  }

  private async delayedPumpLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.promoteDelayed();
      } catch (error) {
        log('promoteDelayed error: %O', error);
      }
      await sleep(POLL_MS);
    }
  }

  private async promoteDelayed(): Promise<void> {
    const now = Date.now();
    // Move due delayed jobs to ready. Small batch to keep the command cheap.
    const due = await this.redis.zrangebyscore(KEY.delayed, 0, now, 'LIMIT', 0, 50);
    if (due.length === 0) return;

    const multi = this.redis.multi();
    for (const id of due) {
      multi.zrem(KEY.delayed, id);
      multi.lpush(KEY.ready, id);
    }
    await multi.exec();
  }

  private async workerLoop(index: number): Promise<void> {
    while (this.running) {
      try {
        // BRPOP blocks up to 1s so stop() can exit promptly.
        const result = await this.redis.brpop(KEY.ready, 1);
        if (!result) {
          // Real Redis BRPOP blocks; non-blocking fakes (tests) must not spin.
          await sleep(20);
          continue;
        }
        const id = result[1];
        await this.processJob(id);
      } catch (error) {
        log('worker[%d] error: %O', index, error);
        await sleep(250);
      }
    }
  }

  private async processJob(id: string): Promise<void> {
    if (await this.redis.exists(KEY.cancel(id))) {
      await this.redis.del(KEY.job(id), KEY.cancel(id));
      return;
    }

    const raw = await this.redis.get(KEY.job(id));
    if (!raw) return;

    let job: JobRecord;
    try {
      job = JSON.parse(raw) as JobRecord;
    } catch {
      await this.redis.del(KEY.job(id));
      return;
    }

    const handler = this.handlers.get(job.name);
    if (!handler) {
      log('no handler for job name=%s id=%s → dlq', job.name, id);
      await this.failPermanent(job, 'no_handler');
      return;
    }

    job.attempts += 1;
    await this.redis.set(KEY.job(id), JSON.stringify(job));

    try {
      await handler(job.payload, job);
      await this.redis.del(KEY.job(id));
      log('done %s name=%s attempts=%d', id, job.name, job.attempts);
    } catch (error) {
      log('fail %s name=%s attempts=%d: %O', id, job.name, job.attempts, error);
      if (job.attempts >= job.maxAttempts) {
        await this.failPermanent(job, error instanceof Error ? error.message : String(error));
        return;
      }
      // Exponential backoff: 1s, 2s, 4s, …
      const delayMs = Math.min(60_000, 1000 * 2 ** (job.attempts - 1));
      job.runAt = Date.now() + delayMs;
      await this.redis.set(KEY.job(id), JSON.stringify(job));
      await this.redis.zadd(KEY.delayed, job.runAt, id);
    }
  }

  private async failPermanent(job: JobRecord, reason: string): Promise<void> {
    await this.redis.lpush(KEY.dlq, JSON.stringify({ ...job, failedAt: Date.now(), reason }));
    await this.redis.del(KEY.job(job.id));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Singleton for the process
let singleton: RedisJobQueue | null = null;

export const getRedisJobQueue = (
  redis: Redis,
  options?: { concurrency?: number },
): RedisJobQueue => {
  if (!singleton) {
    const concurrency = Number(process.env.INTERNAL_JOB_CONCURRENCY) || options?.concurrency;
    singleton = new RedisJobQueue(redis, { concurrency });
  }
  return singleton;
};

/** Test-only: reset singleton between cases. */
export const __resetRedisJobQueueForTests = async () => {
  if (singleton) await singleton.stop();
  singleton = null;
};
