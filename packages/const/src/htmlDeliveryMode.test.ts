import { describe, expect, it } from 'vitest';

import {
  buildHtmlDeliveryInstruction,
  DEFAULT_HTML_DELIVERY_MODE,
  resolveHtmlDeliveryMode,
  withHtmlDeliveryInstruction,
} from './htmlDeliveryMode';

describe('htmlDeliveryMode', () => {
  it('defaults unknown values to artifact', () => {
    expect(resolveHtmlDeliveryMode(undefined)).toBe(DEFAULT_HTML_DELIVERY_MODE);
    expect(resolveHtmlDeliveryMode('nope')).toBe('artifact');
    expect(resolveHtmlDeliveryMode('dingpan')).toBe('dingpan');
    expect(resolveHtmlDeliveryMode('ask')).toBe('ask');
  });

  it('builds distinct hard instructions per mode', () => {
    expect(buildHtmlDeliveryInstruction('artifact')).toContain('Artifact');
    expect(buildHtmlDeliveryInstruction('artifact')).not.toContain('askUserQuestion');
    expect(buildHtmlDeliveryInstruction('dingpan')).toContain('uploadHtmlToDingpan');
    expect(buildHtmlDeliveryInstruction('dingpan')).toMatch(/dual surface|workspace preview/i);
    expect(buildHtmlDeliveryInstruction('dingpan')).toContain('preview_url');
    expect(buildHtmlDeliveryInstruction('ask')).toContain('askUserQuestion');
    expect(buildHtmlDeliveryInstruction('ask')).toContain('可预览可分享');
  });

  it('appends instruction after existing system role', () => {
    const merged = withHtmlDeliveryInstruction('You are helpful.', 'artifact');
    expect(merged.startsWith('You are helpful.')).toBe(true);
    expect(merged).toContain('HTML deliverable surface');
  });
});
