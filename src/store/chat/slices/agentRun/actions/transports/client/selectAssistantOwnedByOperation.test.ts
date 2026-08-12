// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { selectAssistantOwnedByOperation } from './selectAssistantOwnedByOperation';

describe('selectAssistantOwnedByOperation', () => {
  const opA = 'op_a';
  const opB = 'op_b';

  it('selects via messageOperationMap for this operation only', () => {
    const messages = [
      { id: 'asst_other', role: 'assistant', content: '...' },
      { id: 'asst_mine', role: 'assistant', content: '...' },
    ];

    const picked = selectAssistantOwnedByOperation({
      messageOperationMap: {
        asst_other: opB,
        asst_mine: opA,
      },
      messages,
      operationId: opA,
      parentMessageId: 'user_1',
    });

    expect(picked?.id).toBe('asst_mine');
  });

  it('does not pick another operation assistant in the same bucket', () => {
    const messages = [
      { id: 'asst_other', role: 'assistant', content: '...' },
      { id: 'asst_latest_other', role: 'assistant', content: '...' },
    ];

    const picked = selectAssistantOwnedByOperation({
      messageOperationMap: {
        asst_other: opB,
        asst_latest_other: opB,
      },
      messages,
      operationId: opA,
      parentMessageId: 'user_1',
    });

    expect(picked).toBeUndefined();
  });

  it('selects via operationsByMessage when map entry missing', () => {
    const messages = [
      { id: 'asst_shared', role: 'assistant', content: '...' },
      { id: 'asst_mine', role: 'assistant', content: '...' },
    ];

    const picked = selectAssistantOwnedByOperation({
      messages,
      operationId: opA,
      operationsByMessage: {
        asst_shared: [opB],
        asst_mine: [opB, opA],
      },
      parentMessageId: 'user_1',
    });

    expect(picked?.id).toBe('asst_mine');
  });

  it('falls back to assistant parentMessageId (skipCreateFirstMessage)', () => {
    const messages = [
      { id: 'asst_other', role: 'assistant', content: '...' },
      { id: 'asst_parent', role: 'assistant', content: '...' },
    ];

    const picked = selectAssistantOwnedByOperation({
      messages,
      operationId: opA,
      parentMessageId: 'asst_parent',
    });

    expect(picked?.id).toBe('asst_parent');
  });

  it('ignores non-assistant parentMessageId fallback', () => {
    const messages = [
      { id: 'user_1', role: 'user', content: 'hi' },
      { id: 'asst_other', role: 'assistant', content: '...' },
    ];

    const picked = selectAssistantOwnedByOperation({
      messages,
      operationId: opA,
      parentMessageId: 'user_1',
    });

    expect(picked).toBeUndefined();
  });
});
