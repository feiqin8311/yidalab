import { describe, expect, it } from 'vitest';

import { classifyToolError, isTransientToolTransportError } from '../errorClassification';

describe('classifyToolError', () => {
  it('should classify rate limit as retry', () => {
    const result = classifyToolError({ code: 'TOO_MANY_REQUESTS', message: 'rate limit' });

    expect(result.kind).toBe('retry');
  });

  it('should classify forbidden as stop', () => {
    const result = classifyToolError({ message: 'request failed 403 forbidden' });

    expect(result.kind).toBe('stop');
  });

  it('should classify invalid schema as replan', () => {
    const result = classifyToolError(new Error('invalid schema for tool arguments'));

    expect(result.kind).toBe('replan');
  });

  it('should default unknown errors to stop', () => {
    const result = classifyToolError(new Error('unexpected issue'));

    expect(result.kind).toBe('stop');
  });

  it('should classify MCP_EXECUTION_ERROR with 502 as retry (SIF gateway flake)', () => {
    const result = classifyToolError({
      code: 'MCP_EXECUTION_ERROR',
      message:
        'Error calling tool "ops_get_asin_traffic_trend" on MCP server: Streamable HTTP error: Error POSTing to endpoint: 502 Bad Gateway',
    });

    expect(result.kind).toBe('retry');
  });

  it('should classify MCP_EXECUTION_ERROR with fetch failed as retry', () => {
    const result = classifyToolError({
      code: 'MCP_EXECUTION_ERROR',
      message: 'Error calling tool "x" on MCP server: fetch failed',
    });

    expect(result.kind).toBe('retry');
  });

  it('should classify MCP_EXECUTION_ERROR with invalid args as replan', () => {
    const result = classifyToolError({
      code: 'MCP_EXECUTION_ERROR',
      message: 'invalid schema for tool arguments',
    });

    expect(result.kind).toBe('replan');
  });

  it('should default unknown MCP_EXECUTION_ERROR to retry', () => {
    const result = classifyToolError({
      code: 'MCP_EXECUTION_ERROR',
      message: 'Error calling tool "x" on MCP server: something odd',
    });

    expect(result.kind).toBe('retry');
  });
});

describe('isTransientToolTransportError', () => {
  it('returns true for 502 / streamable http', () => {
    expect(
      isTransientToolTransportError(
        new Error('Streamable HTTP error: Error POSTing to endpoint: 502 Bad Gateway'),
      ),
    ).toBe(true);
  });

  it('returns false for client validation errors', () => {
    expect(isTransientToolTransportError(new Error('invalid schema for tool arguments'))).toBe(
      false,
    );
  });
});
