import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { WorkbookApiName, WorkbookIdentifier } from './types';

export const WorkbookManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Inspect a spreadsheet attachment: sheet names, columns, row counts, and budgeted samples. Use before querying large workbooks. fileId comes from the <file id="..."> card in context.',
      name: WorkbookApiName.inspectWorkbook,
      parameters: {
        properties: {
          fileId: {
            description: 'Uploaded file id (files.id / ChatFileItem.id)',
            type: 'string',
          },
        },
        required: ['fileId'],
        type: 'object',
      },
    },
    {
      description:
        'Preview the first N rows of a sheet from a structured workbook asset (does not re-parse XLSX).',
      name: WorkbookApiName.previewSheet,
      parameters: {
        properties: {
          fileId: { type: 'string' },
          limit: { default: 20, maximum: 200, minimum: 1, type: 'number' },
          sheet: {
            description: 'Sheet name or zero-based sheet index as string',
            type: 'string',
          },
        },
        required: ['fileId', 'sheet'],
        type: 'object',
      },
    },
    {
      description:
        'Query sheet rows with optional column projection, filters, orderBy, aggregates (sum/avg/min/max/count + groupBy), and cursor pagination. Results are hard-capped; use nextCursor / hasMore to continue. Prefer aggregates for totals/rankings instead of dumping full grids. Works on chat ephemeral workbooks and Resources persistent assets.',
      name: WorkbookApiName.querySheet,
      parameters: {
        properties: {
          aggregates: {
            description: 'Optional aggregations (sum/avg/min/max/count) over matched rows',
            items: {
              properties: {
                column: { type: 'string' },
                op: { enum: ['sum', 'avg', 'min', 'max', 'count'], type: 'string' },
              },
              required: ['column', 'op'],
              type: 'object',
            },
            type: 'array',
          },
          columns: {
            description: 'Optional column names to return',
            items: { type: 'string' },
            type: 'array',
          },
          cursor: {
            description: 'Opaque cursor from a previous truncated response',
            type: 'string',
          },
          fileId: { type: 'string' },
          filters: {
            items: {
              properties: {
                column: { type: 'string' },
                op: {
                  enum: ['eq', 'contains', 'gt', 'gte', 'lt', 'lte'],
                  type: 'string',
                },
                value: {},
              },
              required: ['column', 'value'],
              type: 'object',
            },
            type: 'array',
          },
          groupBy: {
            description: 'Group keys used with aggregates (omit for whole-sheet summary)',
            items: { type: 'string' },
            type: 'array',
          },
          limit: { default: 50, maximum: 200, minimum: 1, type: 'number' },
          orderBy: {
            items: {
              properties: {
                column: { type: 'string' },
                direction: { enum: ['asc', 'desc'], type: 'string' },
              },
              required: ['column'],
              type: 'object',
            },
            type: 'array',
          },
          sheet: { type: 'string' },
        },
        required: ['fileId', 'sheet'],
        type: 'object',
      },
    },
  ],
  identifier: WorkbookIdentifier,
  meta: {
    avatar: '📊',
    description:
      'Bounded inspect/query for large Excel uploads (manifest + structured sheet assets).',
    title: 'Workbook',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
