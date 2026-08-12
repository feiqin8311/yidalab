import { describe, expect, it } from 'vitest';

import { capSubAgentReturnContent } from './subAgentReturn';

describe('capSubAgentReturnContent', () => {
  it('keeps short content', () => {
    expect(capSubAgentReturnContent('hello')).toBe('hello');
  });

  it('truncates long content', () => {
    const long = 'x'.repeat(50_000);
    const out = capSubAgentReturnContent(long, 100);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain('sub-agent return truncated');
  });
});
