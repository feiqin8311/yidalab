// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { type DingpanDocumentBridge, DingpanExecutionRuntime } from './index';
import * as uploadCore from './uploadCore';

describe('DingpanExecutionRuntime.uploadHtmlToDingpan', () => {
  it('rejects empty html without documentId', async () => {
    const runtime = new DingpanExecutionRuntime();
    const result = await runtime.uploadHtmlToDingpan({ html: '  ' });
    expect(result.success).toBe(false);
    expect(result.content).toMatch(/html or documentId/i);
  });

  it('loads html from document bridge and patches metadata after upload', async () => {
    const bridge: DingpanDocumentBridge = {
      getDeliverableHtml: vi.fn().mockResolvedValue({
        content: '<html><body>ok</body></html>',
        title: 'My Report',
      }),
      patchDingpanMetadata: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(uploadCore, 'uploadHtmlToDingpan').mockResolvedValue({
      fileId: 'fid-1',
      name: 'My Report.html',
      previewUrl: 'https://qr.dingtalk.com/page/yunpan?fileId=fid-1',
      spaceId: 'space-1',
    });

    const runtime = new DingpanExecutionRuntime({ documentBridge: bridge });
    const result = await runtime.uploadHtmlToDingpan({ documentId: 'docs_abc' });

    expect(result.success).toBe(true);
    expect(bridge.getDeliverableHtml).toHaveBeenCalledWith('docs_abc');
    expect(bridge.patchDingpanMetadata).toHaveBeenCalledWith(
      'docs_abc',
      expect.objectContaining({
        previewUrl: expect.stringContaining('fid-1'),
      }),
    );
    expect(result.content).toContain('preview_url');
    expect(result.state?.documentId).toBe('docs_abc');
  });

  it('uploads html without touching the document bridge', async () => {
    const bridge: DingpanDocumentBridge = {
      getDeliverableHtml: vi.fn(),
      patchDingpanMetadata: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(uploadCore, 'uploadHtmlToDingpan').mockResolvedValue({
      fileId: 'fid-2',
      name: 'report.html',
      previewUrl: 'https://example.com/p',
      spaceId: 's',
    });

    const runtime = new DingpanExecutionRuntime({ documentBridge: bridge });
    const result = await runtime.uploadHtmlToDingpan({
      html: '<html>hi</html>',
      title: 'hi',
      topicId: 'tpc_1',
    });

    expect(result.success).toBe(true);
    expect(bridge.getDeliverableHtml).not.toHaveBeenCalled();
    expect(bridge.patchDingpanMetadata).not.toHaveBeenCalled();
    expect(result.state?.documentId).toBeUndefined();
    expect(result.content).toContain('preview_url');
    expect(result.content).not.toContain('document_id');
    expect(result.state).toMatchObject({
      fileId: 'fid-2',
      name: 'report.html',
      previewUrl: 'https://example.com/p',
      success: true,
    });
  });
});
