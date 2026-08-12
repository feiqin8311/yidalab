// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isFilePathOnlyDingpanRedrive, resolveRedrivePayload } from './loop';

describe('resolveRedrivePayload', () => {
  it('prefers message_plugins.apiName over metadata default (approval-resume)', () => {
    const payload = resolveRedrivePayload(
      [
        {
          apiName: 'uploadToDingpan',
          arguments: JSON.stringify({ filePath: '/tmp/a.xlsx' }),
        },
      ],
      {
        apiName: 'uploadHtmlToDingpan',
        payload: { apiName: 'uploadHtmlToDingpan' },
        source: 'model-tool',
      },
    );
    expect(payload?.apiName).toBe('uploadToDingpan');
    expect(payload?.filePath).toBe('/tmp/a.xlsx');
    expect(payload?.html).toBeUndefined();
  });

  it('restores folder/space/naming fields for html redrive', () => {
    const payload = resolveRedrivePayload(
      [
        {
          apiName: 'uploadHtmlToDingpan',
          arguments: JSON.stringify({
            folderLink: 'https://qr.dingtalk.com/page/yunpan?spaceId=1&fileId=folder',
            html: '<html/>',
            site: 'JP',
            title: 'report',
          }),
        },
      ],
      null,
    );
    expect(payload).toMatchObject({
      apiName: 'uploadHtmlToDingpan',
      folderLink: 'https://qr.dingtalk.com/page/yunpan?spaceId=1&fileId=folder',
      html: '<html/>',
      site: 'JP',
      title: 'report',
    });
  });
});

describe('isFilePathOnlyDingpanRedrive', () => {
  it('dead-letters uploadToDingpan without html/documentId immediately', () => {
    expect(
      isFilePathOnlyDingpanRedrive({
        apiName: 'uploadToDingpan',
        filePath: '/tmp/a.xlsx',
      }),
    ).toBe(true);
  });

  it('does not dead-letter html uploads', () => {
    expect(
      isFilePathOnlyDingpanRedrive({
        apiName: 'uploadHtmlToDingpan',
        html: '<html/>',
      }),
    ).toBe(false);
  });
});
