import { describe, expect, it } from 'vitest';

import { parseDingpanUploadResult } from './parseResult';

describe('parseDingpanUploadResult', () => {
  it('prefers pluginState camelCase fields', () => {
    const result = parseDingpanUploadResult(
      JSON.stringify({
        document_id: 'docs_from_content',
        name: 'from-content.html',
        preview_url: 'https://qr.dingtalk.com/from-content',
        success: true,
      }),
      {
        documentId: 'docs_state',
        name: 'from-state.html',
        previewUrl: 'https://qr.dingtalk.com/from-state',
        success: true,
      },
    );

    expect(result).toEqual({
      documentId: 'docs_state',
      name: 'from-state.html',
      previewUrl: 'https://qr.dingtalk.com/from-state',
      success: true,
    });
  });

  it('falls back to snake_case content JSON', () => {
    const result = parseDingpanUploadResult(
      JSON.stringify({
        document_id: 'docs_1',
        name: 'report.html',
        preview_url: 'https://qr.dingtalk.com/p',
        success: true,
      }),
      null,
    );

    expect(result.documentId).toBe('docs_1');
    expect(result.previewUrl).toBe('https://qr.dingtalk.com/p');
    expect(result.success).toBe(true);
  });

  it('captures plain-text failure content', () => {
    const result = parseDingpanUploadResult('Dingpan upload failed: missing folder', null);
    expect(result.success).toBe(false);
    expect(result.errorText).toContain('missing folder');
  });
});
