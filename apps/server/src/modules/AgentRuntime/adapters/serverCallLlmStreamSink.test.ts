import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { createServerCallLlmStreamSink } from './serverCallLlmStreamSink';

describe('ServerCallLlmStreamSink', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes the first text immediately and batches subsequent chunks', async () => {
    const publishStreamChunk = vi.fn().mockResolvedValue(undefined);
    const onFirstPublish = vi.fn();
    const sink = createServerCallLlmStreamSink({
      ctx: {
        operationId: 'operation-1',
        stepIndex: 2,
        streamManager: { publishStreamChunk },
      } as unknown as RuntimeExecutorContext,
      events: [],
      onFirstPublish,
      operationLogId: 'operation-1:2',
    });

    await sink.appendText('first');
    await sink.appendText(' second');
    await sink.appendText(' third');

    expect(publishStreamChunk).toHaveBeenCalledTimes(1);
    expect(publishStreamChunk).toHaveBeenLastCalledWith('operation-1', 2, {
      chunkType: 'text',
      content: 'first',
    });
    expect(onFirstPublish).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(32);

    expect(publishStreamChunk).toHaveBeenCalledTimes(2);
    expect(publishStreamChunk).toHaveBeenLastCalledWith('operation-1', 2, {
      chunkType: 'text',
      content: ' second third',
    });
    expect(onFirstPublish).toHaveBeenCalledTimes(1);
  });
});
