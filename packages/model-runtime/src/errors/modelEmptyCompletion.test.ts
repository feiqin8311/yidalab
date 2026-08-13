import { describe, expect, it } from 'vitest';

import { isEmptyModelCompletion } from './modelEmptyCompletion';

describe('isEmptyModelCompletion', () => {
  it('treats hidden reasoning and token usage without a deliverable as empty', () => {
    expect(
      isEmptyModelCompletion({
        content: '',
        imageCount: 0,
        outputTokens: 128,
        reasoning: 'Hidden reasoning without a final answer',
        toolCallCount: 0,
      }),
    ).toBe(true);
  });

  it('accepts each user-visible output form', () => {
    expect(
      isEmptyModelCompletion({
        content: 'Answer',
        imageCount: 0,
        outputTokens: 1,
        reasoning: '',
        toolCallCount: 0,
      }),
    ).toBe(false);
    expect(
      isEmptyModelCompletion({
        content: '',
        imageCount: 1,
        outputTokens: 1,
        reasoning: '',
        toolCallCount: 0,
      }),
    ).toBe(false);
    expect(
      isEmptyModelCompletion({
        content: '',
        imageCount: 0,
        outputTokens: 1,
        reasoning: '',
        toolCallCount: 1,
      }),
    ).toBe(false);
  });
});
