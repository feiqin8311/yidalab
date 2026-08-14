import { describe, expect, it } from 'vitest';

import { createPromptFingerprint, sortToolsForStablePrompt } from './promptCache';

const tool = (name: string) => ({ function: { name }, type: 'function' });

describe('prompt cache stability', () => {
  it('normalizes tool order before provider serialization', () => {
    expect(sortToolsForStablePrompt([tool('zeta'), tool('alpha'), tool('middle')])).toEqual([
      tool('alpha'),
      tool('middle'),
      tool('zeta'),
    ]);
  });

  it('keeps the fingerprint stable for identical prompt bytes and changes on content edits', () => {
    const input = {
      messages: [{ content: 'hello', role: 'user' }],
      tools: [tool('search')],
    };

    expect(createPromptFingerprint(input)).toBe(createPromptFingerprint(structuredClone(input)));
    expect(createPromptFingerprint(input)).not.toBe(
      createPromptFingerprint({ ...input, messages: [{ content: 'hello!', role: 'user' }] }),
    );
  });
});
