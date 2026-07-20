import { type BuiltinToolManifest } from '@lobechat/types';
import type { JSONSchema7 } from 'json-schema';

import { systemPrompt } from './systemRole';
import { DingpanApiName, DingpanIdentifier } from './types';

export const DingpanManifest: BuiltinToolManifest = {
  api: [
    {
      defaultTimeoutMs: 180_000,
      description:
        'Upload a local file to company DingTalk Drive (钉盘) and return a preview URL. Default folder from credential/env; override with folderLink or spaceId+folderId.',
      name: DingpanApiName.uploadToDingpan,
      parameters: {
        additionalProperties: false,
        properties: {
          filePath: {
            description: 'Absolute path of the local file to upload',
            type: 'string',
          },
          folderId: {
            description:
              'Optional folder dentry id for this upload only (use with spaceId). Overrides default folder.',
            type: 'string',
          },
          folderLink: {
            description:
              'Optional DingTalk Drive folder link for this upload only. Overrides default folder.',
            type: 'string',
          },
          spaceId: {
            description:
              'Optional space id for this upload only (use with folderId). Overrides default folder.',
            type: 'string',
          },
          uploadName: {
            description: 'Optional remote file name. Defaults to the local basename.',
            type: 'string',
          },
        },
        required: ['filePath'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      defaultTimeoutMs: 10_000,
      description:
        'Check whether Dingpan app credentials and default folder are configured. Does not reveal secret values.',
      name: DingpanApiName.dingpanStatus,
      parameters: {
        additionalProperties: false,
        properties: {},
        type: 'object',
      } satisfies JSONSchema7,
    },
  ],
  identifier: DingpanIdentifier,
  meta: {
    avatar: '📎',
    description:
      'Default file delivery to DingTalk Drive (钉盘): upload reports and return preview_url. Prefer Artifacts for interactive HTML in chat.',
    title: 'Dingpan',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
