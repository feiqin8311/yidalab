import { type BuiltinToolManifest } from '@lobechat/types';
import type { JSONSchema7 } from 'json-schema';

import { systemPrompt } from './systemRole';
import { DingpanApiName, DingpanIdentifier } from './types';

/** Upload-HTML-only surface for forceFinish delivery (no file upload / status). */
export const DingpanDeliveryManifest: BuiltinToolManifest = {
  api: [
    {
      defaultTimeoutMs: 180_000,
      description:
        "Upload an HTML report to DingTalk Drive under today's date folder and return preview_url. HTML stays on the tool message for in-chat preview (not the resource library). Prefer structured naming fields (asin/site/taskType); server fills userName.",
      name: DingpanApiName.uploadHtmlToDingpan,
      parameters: {
        additionalProperties: false,
        properties: {
          asin: { description: 'ASIN for the remote filename', type: 'string' },
          html: {
            description:
              'Full HTML document string (required). Kept on the message as an artifact for chat preview; does not create a resource document.',
            type: 'string',
          },
          keyword: { description: 'Keyword segment for the filename', type: 'string' },
          productName: { description: 'Short product name for the filename', type: 'string' },
          site: { description: 'Market/site label, e.g. 日本 / US / CA', type: 'string' },
          taskType: { description: 'Task short label, e.g. 推广复盘', type: 'string' },
          title: {
            description: 'Optional display title (does not create a resource document)',
            type: 'string',
          },
          uploadName: { description: 'Optional full remote file name override', type: 'string' },
        },
        required: ['html'],
        type: 'object',
      } satisfies JSONSchema7,
    },
  ],
  identifier: DingpanIdentifier,
  meta: {
    avatar: '📎',
    description:
      'Force-finish delivery: upload HTML to 钉盘; preview from message HTML (no auto resource).',
    title: 'Dingpan',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};

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
        "Upload an HTML report to DingTalk Drive under today's date folder and return preview_url. HTML is kept on the tool message for in-chat preview (message artifact) — does not auto-create a resource document. Prefer structured naming (asin/site/taskType). Example: B0GVDTV1J6_日本_推广复盘_柯鹏翔_20260723.html",
      name: DingpanApiName.uploadHtmlToDingpan,
      parameters: {
        additionalProperties: false,
        properties: {
          asin: {
            description: 'ASIN for the remote filename, e.g. B0GVDTV1J6',
            type: 'string',
          },
          documentId: {
            description:
              'Optional existing documents.id owned by the current user. Only for uploading an already-created resource; HTML is loaded from that document and dingpan metadata is written back. Do not invent this id for new reports — use html instead.',
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
              'Full HTML document string. Preferred for new reports. Stored on the tool message as a chat artifact for preview; does not create a resource-library document.',
            type: 'string',
          },
          keyword: {
            description: 'Keyword segment for the filename when ASIN is not used.',
            type: 'string',
          },
          productName: {
            description: 'Short product name for the filename.',
            type: 'string',
          },
          site: {
            description: 'Market/site label for the filename, e.g. 日本 / US',
            type: 'string',
          },
          spaceId: {
            description: 'Optional space id for this upload only (use with folderId).',
            type: 'string',
          },
          taskType: {
            description: 'Task short label for the filename, e.g. 推广复盘',
            type: 'string',
          },
          title: {
            description: 'Optional display title (does not create a resource document).',
            type: 'string',
          },
          topicId: {
            description: 'Optional topic id (legacy; not used to create resource documents).',
            type: 'string',
          },
          uploadName: {
            description:
              'Optional full remote file name override. Prefer asin/site/taskType instead. Default: {ASIN}_{站点}_{任务}_{用户}_{YYYYMMDD}.html',
            type: 'string',
          },
          userName: {
            description:
              'Current human user display name (not agent). Usually injected by the server.',
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
      'Deliver files and HTML reports to DingTalk Drive (钉盘) with preview_url. HTML delivery keeps content on the message for chat preview (no auto resource document); use documentId only for existing resources.',
    title: 'Dingpan',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
