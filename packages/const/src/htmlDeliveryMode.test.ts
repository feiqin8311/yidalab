import { describe, expect, it } from 'vitest';

import {
  buildHtmlDeliveryInstruction,
  DEFAULT_HTML_DELIVERY_MODE,
  resolveHtmlDeliveryMode,
  withHtmlDeliveryInstruction,
} from './htmlDeliveryMode';

describe('htmlDeliveryMode', () => {
  it('defaults unknown values to dingpan', () => {
    expect(resolveHtmlDeliveryMode(undefined)).toBe(DEFAULT_HTML_DELIVERY_MODE);
    expect(DEFAULT_HTML_DELIVERY_MODE).toBe('dingpan');
    expect(resolveHtmlDeliveryMode('nope')).toBe('dingpan');
    expect(resolveHtmlDeliveryMode('dingpan')).toBe('dingpan');
    expect(resolveHtmlDeliveryMode('ask')).toBe('ask');
    expect(resolveHtmlDeliveryMode('artifact')).toBe('artifact');
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
