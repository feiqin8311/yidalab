export type ConsumeStreamTimeoutKind = 'first_chunk' | 'idle' | 'hard_limit';

const ERROR_TYPE_BY_KIND: Record<ConsumeStreamTimeoutKind, string> = {
  first_chunk: 'LLM_FIRST_CHUNK_TIMEOUT',
  hard_limit: 'LLM_TURN_HARD_LIMIT',
  idle: 'LLM_STREAM_IDLE_TIMEOUT',
};

export class LLMStreamTimeoutError extends Error {
  readonly errorType: string;
  readonly kind: ConsumeStreamTimeoutKind;

  constructor(kind: ConsumeStreamTimeoutKind, timeoutMs: number) {
    const errorType = ERROR_TYPE_BY_KIND[kind];
    super(
      kind === 'first_chunk'
        ? `LLM_FIRST_CHUNK_TIMEOUT: no first byte after ${timeoutMs}ms`
        : kind === 'idle'
          ? `LLM_STREAM_IDLE_TIMEOUT: stream silent for ${timeoutMs}ms`
          : `LLM_TURN_HARD_LIMIT: turn exceeded ${timeoutMs}ms`,
    );
    this.name = 'LLMStreamTimeoutError';
    this.kind = kind;
    this.errorType = errorType;
  }
}

export interface ConsumeStreamUntilDoneOptions {
  /** Abort if no bytes arrive at all. */
  firstChunkTimeoutMs?: number;
  /** Abort if no new bytes arrive after the first chunk. */
  idleTimeoutMs?: number;
  /** Abort if the stream never ends. */
  totalTimeoutMs?: number;
}

const raceRead = async <T>(
  read: Promise<T>,
  timeoutMs: number,
  kind: ConsumeStreamTimeoutKind,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LLMStreamTimeoutError(kind, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Consumes a Response stream completely to ensure all callbacks are executed
 * @param response - The Response object with a ReadableStream body
 * @returns Promise that resolves when the stream is fully consumed
 *
 * @example
 * ```ts
 * const response = await modelRuntime.chat(payload, {
 *   callback: {
 *     onText: async (text) => {
 *       await saveToDatabase(text);
 *     }
 *   }
 * });
 *
 * // Ensure all callbacks complete before proceeding
 * await consumeStreamUntilDone(response);
 * ```
 */
export async function consumeStreamUntilDone(
  response: Response,
  options: ConsumeStreamUntilDoneOptions = {},
): Promise<void> {
  if (!response.body) {
    return;
  }

  const firstChunkTimeoutMs = options.firstChunkTimeoutMs ?? 0;
  const idleTimeoutMs = options.idleTimeoutMs ?? 0;
  const totalTimeoutMs = options.totalTimeoutMs ?? 0;
  const startedAt = Date.now();
  const reader = response.body.getReader();
  let sawChunk = false;

  try {
    while (true) {
      const remainingTotal =
        totalTimeoutMs > 0 ? totalTimeoutMs - (Date.now() - startedAt) : Number.POSITIVE_INFINITY;
      if (remainingTotal <= 0) {
        throw new LLMStreamTimeoutError('hard_limit', totalTimeoutMs);
      }

      const activityWait = sawChunk ? idleTimeoutMs : firstChunkTimeoutMs;
      const limitedByActivity = activityWait > 0 && activityWait <= remainingTotal;
      const waitMs = Math.min(
        activityWait > 0 ? activityWait : Number.POSITIVE_INFINITY,
        remainingTotal,
      );
      const kind: ConsumeStreamTimeoutKind = limitedByActivity
        ? sawChunk
          ? 'idle'
          : 'first_chunk'
        : 'hard_limit';

      const read = reader.read();
      const { done } = Number.isFinite(waitMs) ? await raceRead(read, waitMs, kind) : await read;

      if (done) break;
      sawChunk = true;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    reader.releaseLock();
  }
}
