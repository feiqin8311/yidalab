// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { previewToolsCallingForStream } from './previewToolsCallingForStream';

describe('previewToolsCallingForStream', () => {
  it('leaves small arguments unchanged', () => {
    const tools = [
      {
        apiName: 'uploadHtmlToDingpan',
        arguments: JSON.stringify({ html: '<p>ok</p>' }),
        id: 'c1',
        identifier: 'lobe-dingpan',
        type: 'builtin' as const,
      },
    ];
    expect(previewToolsCallingForStream(tools)).toEqual(tools);
  });

  it('truncates huge html for the stream but keeps the tool id', () => {
    const html = `<html>${'x'.repeat(2000)}</html>`;
    const [preview] = previewToolsCallingForStream([
      {
        apiName: 'uploadHtmlToDingpan',
        arguments: JSON.stringify({ asin: 'B00', html }),
        id: 'c1',
        identifier: 'lobe-dingpan',
        type: 'builtin',
      },
    ]);

    expect(preview.id).toBe('c1');
    const args = JSON.parse(preview.arguments || '{}') as { asin: string; html: string };
    expect(args.asin).toBe('B00');
    expect(args.html.length).toBeLessThan(html.length);
    expect(args.html).toContain('stream preview truncated');
  });
});
