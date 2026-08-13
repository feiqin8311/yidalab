import { describe, expect, it } from 'vitest';

import { ChatMessageErrorSchema } from './base';

describe('ChatMessageErrorSchema', () => {
  it('accepts a typed error', () => {
    const parsed = ChatMessageErrorSchema.parse({ message: 'boom', type: 'PluginServerError' });
    expect(parsed.type).toBe('PluginServerError');
  });

  it('defaults missing type so updateMessage does not 400', () => {
    const parsed = ChatMessageErrorSchema.parse({ message: 'test error' });
    expect(parsed.type).toBe('UnknownChatError');
  });

  it('defaults explicit undefined type', () => {
    const parsed = ChatMessageErrorSchema.parse({ message: 'mcp fail', type: undefined });
    expect(parsed.type).toBe('UnknownChatError');
  });
});
