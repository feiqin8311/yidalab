import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { FilesApiName, FilesIdentifier } from './types';

export const FilesManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Inspect a chat attachment by fileId: name, type, size, parse/extract status, and whether more content is available via readAttachment. Prefer this before large reads.',
      name: FilesApiName.inspectAttachment,
      parameters: {
        additionalProperties: false,
        properties: {
          fileId: {
            description: 'Uploaded file id from the <file id="..."> card',
            type: 'string',
          },
        },
        required: ['fileId'],
        type: 'object',
      },
    },
    {
      description:
        'Read extracted text from a chat attachment with character offset/limit pagination. Returns nextOffset when truncated. Does not expose storage keys or signed download URLs as a reading path.',
      name: FilesApiName.readAttachment,
      parameters: {
        additionalProperties: false,
        properties: {
          fileId: {
            description: 'Uploaded file id from the <file id="..."> card',
            type: 'string',
          },
          limit: {
            default: 4000,
            description: 'Max characters to return (1–12000)',
            maximum: 12_000,
            minimum: 1,
            type: 'number',
          },
          offset: {
            default: 0,
            description: 'Character offset into extracted text',
            minimum: 0,
            type: 'number',
          },
          pages: {
            description: 'Optional 1-based page numbers when the document supports page slices',
            items: { minimum: 1, type: 'number' },
            type: 'array',
          },
        },
        required: ['fileId'],
        type: 'object',
      },
    },
    {
      description:
        'Search keyword snippets inside an attachment extract. Returns bounded matches with approximate offsets.',
      name: FilesApiName.searchAttachment,
      parameters: {
        additionalProperties: false,
        properties: {
          fileId: {
            description: 'Uploaded file id from the <file id="..."> card',
            type: 'string',
          },
          limit: {
            default: 5,
            description: 'Max snippets (1–20)',
            maximum: 20,
            minimum: 1,
            type: 'number',
          },
          query: {
            description: 'Case-insensitive substring to find',
            minLength: 1,
            type: 'string',
          },
        },
        required: ['fileId', 'query'],
        type: 'object',
      },
    },
  ],
  identifier: FilesIdentifier,
  meta: {
    avatar: '📎',
    description:
      'On-demand inspect/read/search for chat message attachments (not Agent documents).',
    title: 'Files',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
