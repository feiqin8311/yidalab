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
      defaultTimeoutMs: 180_000,
      description:
        'Upload an HTML report to DingTalk Drive and return preview_url. Prefer documentId of a persisted deliverable, or pass html to create one. Content is stored per-user before upload. Does not require an execution device.',
      name: DingpanApiName.uploadHtmlToDingpan,
      parameters: {
        additionalProperties: false,
        properties: {
          documentId: {
            description:
              'Optional documents.id owned by the current user. When set, HTML is loaded from the document and dingpan metadata is written back.',
            type: 'string',
          },
          folderId: {
            description: 'Optional folder dentry id for this upload only (use with spaceId).',
            type: 'string',
          },
          folderLink: {
            description: 'Optional DingTalk Drive folder link for this upload only.',
            type: 'string',
          },
          html: {
            description:
              'Full HTML document string. Required when documentId is omitted; also used when creating a new deliverable document.',
            type: 'string',
          },
          spaceId: {
            description: 'Optional space id for this upload only (use with folderId).',
            type: 'string',
          },
          title: {
            description: 'Title for the persisted document (defaults from uploadName).',
            type: 'string',
          },
          topicId: {
            description: 'Topic id to associate a newly created deliverable document with.',
            type: 'string',
          },
          uploadName: {
            description: 'Optional remote file name. Defaults to report-YYYYMMDDHHmmss.html',
            type: 'string',
          },
        },
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
      'Deliver files and HTML reports to DingTalk Drive (钉盘) with preview_url. HTML can be persisted per-user then uploaded; chat can still use Artifacts when the user chooses in-app preview.',
    title: 'Dingpan',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
