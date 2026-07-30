import { isNotNull, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

import type { LobeDocumentPage } from '@/types/document';
import type { FileSource } from '@/types/files';

import { idGenerator, randomSlug } from '../utils/idGenerator';
import { accessedAt, createdAt, timestamps, timestamptz } from './_helpers';
import { asyncTasks } from './asyncTask';
import { users } from './user';
import { workspaces } from './workspace';

export const DOCUMENT_FOLDER_TYPE = 'custom/folder';

/** Chat-attachment structured parse lifecycle (workbooks first). */
export type FileParseStatus =
  'uploaded' | 'queued' | 'parsing' | 'ready' | 'failed' | 'unsupported';

/** File type used by the parent document for a managed skill bundle. */
export const SKILL_BUNDLE_FILE_TYPE = 'skills/bundle';

/** File type used by the SKILL.md index document inside a managed skill bundle. */
export const SKILL_INDEX_FILE_TYPE = 'skills/index';

/** Source attribution stored on documents created by skill-management tooling. */
export const SKILL_MANAGEMENT_SOURCE = 'agent-signal:skill-management';

/** Source type stored on documents created by Agent Signal skill-management tooling. */
export const SKILL_MANAGEMENT_SOURCE_TYPE = 'agent-signal';

/** Canonical filename for a skill index document. */
export const SKILL_INDEX_FILENAME = 'SKILL.md';

/** Template id applied to agent document bindings that represent managed skills. */
export const AGENT_SKILL_TEMPLATE_ID = 'agent-skill';

export const globalFiles = pgTable(
  'global_files',
  {
    hashId: varchar('hash_id', { length: 64 }).primaryKey(),
    fileType: varchar('file_type', { length: 255 }).notNull(),
    size: integer('size').notNull(),
    url: text('url').notNull(),
    metadata: jsonb('metadata'),
    creator: text('creator')
      .references(() => users.id, { onDelete: 'set null' })
      .notNull(),
    createdAt: createdAt(),
    accessedAt: accessedAt(),
  },
  (t) => [index('global_files_creator_idx').on(t.creator)],
);

export type NewGlobalFile = typeof globalFiles.$inferInsert;
export type GlobalFileItem = typeof globalFiles.$inferSelect;

/**
 * Documents table - Stores file content or web search results
 */
export const documents = pgTable(
  'documents',
  {
    id: varchar('id', { length: 255 })
      .$defaultFn(() => idGenerator('documents', 16))
      .primaryKey(),

    // Basic information
    title: text('title'),
    description: text('description'),
    content: text('content'),

    // Special type: custom/folder
    fileType: varchar('file_type', { length: 255 }).notNull(),
    filename: text('filename'),

    // Statistics
    totalCharCount: integer('total_char_count').notNull(),
    totalLineCount: integer('total_line_count').notNull(),

    // Metadata
    metadata: jsonb('metadata').$type<Record<string, any>>(),

    // Page/chunk data
    pages: jsonb('pages').$type<LobeDocumentPage[]>(),

    // Source type
    sourceType: text('source_type', {
      enum: ['file', 'web', 'api', 'topic', 'agent', 'agent-signal'],
    }).notNull(),
    source: text('source').notNull(), // File path or web URL

    // Associated file (optional)
    // forward reference needs AnyPgColumn to avoid circular type inference

    fileId: text('file_id').references((): AnyPgColumn => files.id, { onDelete: 'set null' }),

    knowledgeBaseId: text('knowledge_base_id').references(() => knowledgeBases.id, {
      onDelete: 'set null',
    }),

    // Parent document (for folder hierarchy structure)
    parentId: varchar('parent_id', { length: 255 }).references((): AnyPgColumn => documents.id, {
      onDelete: 'set null',
    }),

    // User association
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: text('client_id'),

    editorData: jsonb('editor_data').$type<Record<string, any>>(),

    slug: varchar('slug', { length: 255 }).$defaultFn(() => randomSlug(3)),

    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /**
     * Visibility within the owning workspace. `public` (default) means every
     * workspace member can see the document; `private` constrains it to the
     * creator (`user_id`). Within a documents tree (folder/Page hierarchy) the
     * value is kept strongly consistent across the whole subtree by the service
     * layer — children mirror the root's visibility, and the only legal
     * transition is `private → public` via `publishToWorkspace`. Ignored in
     * personal mode where the row is implicitly private to its owner.
     */
    visibility: text('visibility', { enum: ['private', 'public'] })
      .default('public')
      .notNull(),

    // Timestamps
    ...timestamps,
  },
  (table) => [
    index('documents_source_idx').on(table.source),
    index('documents_file_type_idx').on(table.fileType),
    index('documents_source_type_idx').on(table.sourceType),
    index('documents_user_id_idx').on(table.userId),
    index('documents_file_id_idx').on(table.fileId),
    index('documents_parent_id_idx').on(table.parentId),
    index('documents_knowledge_base_id_idx').on(table.knowledgeBaseId),
    uniqueIndex('documents_client_id_user_id_unique').on(table.clientId, table.userId),
    uniqueIndex('documents_slug_user_id_unique')
      .on(table.slug, table.userId)
      .where(sql`${table.workspaceId} IS NULL AND ${table.slug} IS NOT NULL`),
    index('documents_workspace_id_idx').on(table.workspaceId),
    index('documents_workspace_visibility_idx').on(
      table.workspaceId,
      table.visibility,
      table.userId,
    ),
    uniqueIndex('documents_slug_workspace_id_unique')
      .on(table.workspaceId, table.slug)
      .where(isNotNull(table.workspaceId)),
  ],
);

export type NewDocument = typeof documents.$inferInsert;
export type DocumentItem = typeof documents.$inferSelect;
export const insertDocumentSchema = createInsertSchema(documents);

export const files = pgTable(
  'files',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('files'))
      .primaryKey(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /**
     * mime
     */
    fileType: varchar('file_type', { length: 255 }).notNull(),
    /**
     * sha256
     */
    fileHash: varchar('file_hash', { length: 64 }).references(() => globalFiles.hashId, {
      onDelete: 'no action',
    }),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    url: text('url').notNull(),
    source: text('source').$type<FileSource>(),

    // Parent Folder or Document
    parentId: varchar('parent_id', { length: 255 }).references((): AnyPgColumn => documents.id, {
      onDelete: 'set null',
    }),

    clientId: text('client_id'),
    metadata: jsonb('metadata'),
    chunkTaskId: uuid('chunk_task_id').references(() => asyncTasks.id, { onDelete: 'set null' }),
    embeddingTaskId: uuid('embedding_task_id').references(() => asyncTasks.id, {
      onDelete: 'set null',
    }),

    /**
     * Structured parse lifecycle for chat attachments (esp. workbooks).
     * uploaded → queued → parsing → ready | failed | unsupported
     */
    parseStatus: text('parse_status').$type<FileParseStatus>().default('uploaded'),
    /** Human/machine parse failure detail when parseStatus=failed */
    parseError: text('parse_error'),
    /** Parser implementation version for idempotent rebuilds */
    parserVersion: text('parser_version'),
    parseTaskId: uuid('parse_task_id').references(() => asyncTasks.id, {
      onDelete: 'set null',
    }),
    parsedAt: timestamptz('parsed_at'),

    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /**
     * Visibility within the owning workspace. `public` (default) means every
     * workspace member can see the file; `private` constrains it to the
     * creator (`user_id`). The only legal transition is `private → public`
     * via `publishToWorkspace`. Ignored in personal mode (`workspace_id IS NULL`)
     * where the row is implicitly private to its owner.
     */
    visibility: text('visibility', { enum: ['private', 'public'] })
      .default('public')
      .notNull(),

    ...timestamps,
  },
  (table) => {
    return {
      fileHashIdx: index('file_hash_idx').on(table.fileHash),
      userIdIdx: index('files_user_id_idx').on(table.userId),
      parentIdIdx: index('files_parent_id_idx').on(table.parentId),
      chunkTaskIdIdx: index('files_chunk_task_id_idx').on(table.chunkTaskId),
      embeddingTaskIdIdx: index('files_embedding_task_id_idx').on(table.embeddingTaskId),
      parseStatusIdx: index('files_parse_status_idx').on(table.parseStatus),
      parseTaskIdIdx: index('files_parse_task_id_idx').on(table.parseTaskId),
      clientIdUnique: uniqueIndex('files_client_id_user_id_unique').on(
        table.clientId,
        table.userId,
      ),
      workspaceIdIdx: index('files_workspace_id_idx').on(table.workspaceId),
      workspaceVisibilityIdx: index('files_workspace_visibility_idx').on(
        table.workspaceId,
        table.visibility,
        table.userId,
      ),
    };
  },
);
export type NewFile = typeof files.$inferInsert;
export type FileItem = typeof files.$inferSelect;

/** Workbook-level structured parse result (one row per file). */
export interface FileWorkbookManifestSheet {
  columnCount: number;
  columns: string[];
  name: string;
  rowCount: number;
  /** Budgeted sample rows for prompt cards (not full data). */
  sampleRows: Record<string, string>[];
  sheetIndex: number;
}

export interface FileWorkbookManifest {
  /** When true, sheets/columns were capped at parse time. */
  coverage?: {
    columnsCapped?: boolean;
    sheetsCapped?: boolean;
    sourceSheetCount?: number;
  };
  fileName?: string;
  parserVersion: string;
  sheetCount: number;
  sheets: FileWorkbookManifestSheet[];
  totalRows: number;
  /** Approximate tokens if the whole workbook were inlined as markdown. */
  unrestrictedTokenEstimate?: number;
}

export const fileWorkbooks = pgTable(
  'file_workbooks',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('files', 16))
      .primaryKey(),
    fileId: text('file_id')
      .references(() => files.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    parserVersion: text('parser_version').notNull(),
    /**
     * Monotonic publish generation. Workers write assets under this id;
     * only the generation that completes may flip status to ready.
     */
    generationId: text('generation_id'),
    status: text('status').$type<FileParseStatus>().notNull().default('ready'),
    sheetCount: integer('sheet_count').notNull().default(0),
    totalRows: integer('total_rows').notNull().default(0),
    tokenEstimate: integer('token_estimate'),
    manifest: jsonb('manifest').$type<FileWorkbookManifest>(),
    error: text('error'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('file_workbooks_file_id_parser_version_unique').on(t.fileId, t.parserVersion),
    index('file_workbooks_file_id_idx').on(t.fileId),
    index('file_workbooks_user_id_idx').on(t.userId),
    index('file_workbooks_workspace_id_idx').on(t.workspaceId),
    index('file_workbooks_status_idx').on(t.status),
  ],
);

export type NewFileWorkbook = typeof fileWorkbooks.$inferInsert;
export type FileWorkbookItem = typeof fileWorkbooks.$inferSelect;

export interface FileSheetColumnMeta {
  name: string;
}

/**
 * Per-sheet query asset. Full rows live in `storage_key` (S3 JSONL) or
 * small-sheet `inline_jsonl` — never re-parse the original XLSX on query.
 */
export const fileSheetAssets = pgTable(
  'file_sheet_assets',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('files', 16))
      .primaryKey(),
    workbookId: text('workbook_id')
      .references(() => fileWorkbooks.id, { onDelete: 'cascade' })
      .notNull(),
    fileId: text('file_id')
      .references(() => files.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    sheetName: text('sheet_name').notNull(),
    sheetIndex: integer('sheet_index').notNull().default(0),
    rowCount: integer('row_count').notNull().default(0),
    columnCount: integer('column_count').notNull().default(0),
    columns: jsonb('columns').$type<FileSheetColumnMeta[]>().notNull().default([]),
    /** S3 key for sheet body (jsonl or future parquet) */
    storageKey: text('storage_key'),
    /** Small sheets only — full JSONL body when under inline cap */
    inlineJsonl: text('inline_jsonl'),
    /**
     * Asset encoding: `jsonl` (default) or `parquet` (DuckDB path, future).
     * Query layer switches on this flag — never re-open XLSX.
     */
    format: text('format').$type<'jsonl' | 'parquet'>().notNull().default('jsonl'),
    generationId: text('generation_id'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('file_sheet_assets_workbook_sheet_gen_unique').on(
      t.workbookId,
      t.sheetName,
      t.generationId,
    ),
    index('file_sheet_assets_file_id_idx').on(t.fileId),
    index('file_sheet_assets_workbook_id_idx').on(t.workbookId),
    index('file_sheet_assets_user_id_idx').on(t.userId),
  ],
);

export type NewFileSheetAsset = typeof fileSheetAssets.$inferInsert;
export type FileSheetAssetItem = typeof fileSheetAssets.$inferSelect;

/** Knowledge-base visibility — shared by column def and insert schema. */
export const KNOWLEDGE_BASE_VISIBILITY = ['private', 'public'] as const;

export const knowledgeBases = pgTable(
  'knowledge_bases',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('knowledgeBases'))
      .primaryKey(),

    name: text('name').notNull(),
    description: text('description'),
    avatar: text('avatar'),

    // different types of knowledge bases need to be distinguished
    type: text('type'),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: text('client_id'),

    isPublic: boolean('is_public').default(false),

    settings: jsonb('settings'),

    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /**
     * Visibility within the owning workspace. `public` (default) means every
     * workspace member sees the KB in their sidebar; `private` constrains
     * discoverability to the creator (`user_id`). The only legal transition is
     * `private → public` via `publishKnowledgeBaseToWorkspace`. Ignored in
     * personal mode (`workspace_id IS NULL`).
     *
     * Independent of `isPublic` (marketplace discovery) and `files.visibility`
     * (file-level workspace visibility). This column only gates *KB list*
     * enumeration; retrieval via a known KB id still goes through `ownership()`.
     */
    visibility: text('visibility', { enum: KNOWLEDGE_BASE_VISIBILITY }).default('public').notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('knowledge_bases_client_id_user_id_unique').on(t.clientId, t.userId),
    index('knowledge_bases_user_id_idx').on(t.userId),
    index('knowledge_bases_workspace_id_idx').on(t.workspaceId),
    index('knowledge_bases_workspace_visibility_idx').on(t.workspaceId, t.visibility, t.userId),
  ],
);

// See insertSessionGroupSchema: Zod 4 + drizzle-zod text-enum inference pollution.
// `.optional()` preserves defaulted-column omit semantics at runtime.
// Enum values from KNOWLEDGE_BASE_VISIBILITY so column def and schema stay in sync.
export const insertKnowledgeBasesSchema = createInsertSchema(knowledgeBases, {
  visibility: z.enum(KNOWLEDGE_BASE_VISIBILITY).optional(),
});

export type NewKnowledgeBase = typeof knowledgeBases.$inferInsert;
export type KnowledgeBaseItem = typeof knowledgeBases.$inferSelect;

export const knowledgeBaseFiles = pgTable(
  'knowledge_base_files',
  {
    knowledgeBaseId: text('knowledge_base_id')
      .references(() => knowledgeBases.id, { onDelete: 'cascade' })
      .notNull(),

    fileId: text('file_id')
      .references(() => files.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.knowledgeBaseId, t.fileId] }),
    index('knowledge_base_files_kb_id_idx').on(t.knowledgeBaseId),
    index('knowledge_base_files_user_id_idx').on(t.userId),
    index('knowledge_base_files_file_id_idx').on(t.fileId),
    index('knowledge_base_files_workspace_id_idx').on(t.workspaceId),
  ],
);
