import { describe, expect, it } from 'vitest';

import { parseDingpanUploadResult } from './parseResult';

const trusted = (fileId: string) =>
  `https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=${fileId}&type=file`;

describe('parseDingpanUploadResult', () => {
  it('prefers pluginState camelCase fields when URL is trusted', () => {
    const previewUrl = trusted('from-state');
    const result = parseDingpanUploadResult(
      JSON.stringify({
        document_id: 'docs_from_content',
        name: 'from-content.html',
        preview_url: trusted('from-content'),
        success: true,
      }),
      {
        documentId: 'docs_state',
        name: 'from-state.html',
        previewUrl,
        success: true,
      },
    );

    expect(result).toEqual({
      documentId: 'docs_state',
      name: 'from-state.html',
      previewUrl,
      success: true,
    });
  });

  it('falls back to snake_case content JSON when trusted', () => {
    const previewUrl = trusted('p');
    const result = parseDingpanUploadResult(
      JSON.stringify({
        document_id: 'docs_1',
        name: 'report.html',
        preview_url: previewUrl,
        success: true,
      }),
      null,
    );

    expect(result.documentId).toBe('docs_1');
    expect(result.previewUrl).toBe(previewUrl);
    expect(result.success).toBe(true);
  });

  it('rejects evil http URLs even with success=true', () => {
    const result = parseDingpanUploadResult(
      JSON.stringify({ preview_url: 'https://evil.example/phish', success: true }),
      null,
    );
    expect(result.success).toBe(false);
    expect(result.previewUrl).toBeUndefined();
  });

  it('captures plain-text failure content', () => {
    const result = parseDingpanUploadResult('Dingpan upload failed: missing folder', null);
    expect(result.success).toBe(false);
    expect(result.errorText).toContain('missing folder');
  });

  it('surfaces deliveryAttemptId for UI redrive', () => {
    const result = parseDingpanUploadResult(JSON.stringify({ success: false, error: '403' }), {
      deliveryAttemptId: 'dla_1',
      success: false,
    });
    expect(result.deliveryAttemptId).toBe('dla_1');
    expect(result.success).toBe(false);
  });
});
