import { z } from 'zod';

import type { AsyncTaskStatus, FileParsingTask } from '../asyncTask';

export interface KnowledgeItemStatus extends FileParsingTask {
  id: string;
}

export interface FileUploader {
  avatar?: string | null;
  id: string;
  username?: string | null;
}

export interface FileListItem {
  chunkCount: number | null;
  chunkingError: any | null;
  chunkingStatus?: AsyncTaskStatus | null;
  /**
   * Text content of the document (for notes/documents)
   */
  content?: string | null;
  createdAt: Date;
  editorData?: Record<string, any> | null;
  embeddingError: any | null;
  embeddingStatus?: AsyncTaskStatus | null;
  fileId?: string | null;
  fileType: string;
  finishEmbedding: boolean;
  id: string;
  /**
   * Metadata (for notes/documents)
   */
  metadata?: Record<string, any> | null;
  name: string;
  /**
   * Parent folder ID (for folder hierarchy)
   */
  parentId?: string | null;
  size: number;
  slug?: string | null;
  sourceType: string;
  updatedAt: Date;
  /**
   * The user who uploaded the file. Populated by the server list query when
   * available; falls back to `null` for rows without a joinable user (rare,
   * e.g. deleted accounts) or when the caller doesn't need it.
   */
  uploader?: FileUploader | null;
  url: string;
  userId?: string | null;
  /**
   * Workspace visibility. `null` (or absent) means the row predates the
   * column / is in personal mode. UI uses this together with `userId` to
   * surface the lock icon and the publish-to-workspace affordance.
   */
  visibility?: 'private' | 'public' | null;
}

export enum SortType {
  Asc = 'asc',
  Desc = 'desc',
}

/**
 * Workspace resource list "space".
 * - mine: rows I created
 * - shared_with_me: private rows granted to me / my department
 * - workspace: public (whole company)
 * - admin_all: everything in the workspace (owner/admin only)
 */
export const ResourceListScopeSchema = z.enum(['mine', 'shared_with_me', 'workspace', 'admin_all']);
export type ResourceListScope = z.infer<typeof ResourceListScopeSchema>;

export const QueryFileListSchema = z.object({
  category: z.string().optional(),
  knowledgeBaseId: z.string().optional(),
  limit: z.number().int().positive().default(50),
  /**
   * Preferred list filter in workspace mode. When set, takes precedence over
   * legacy `visibility`. Ignored in personal mode.
   */
  listScope: ResourceListScopeSchema.optional(),
  offset: z.number().int().min(0).default(0),
  parentId: z.string().nullish(),
  q: z.string().nullish(),
  showFilesInKnowledgeBase: z.boolean().default(false),
  sortType: z.enum(['desc', 'asc']).optional(),
  sorter: z.enum(['createdAt', 'size']).optional(),
  /**
   * Legacy workspace-mode visibility filter. Prefer `listScope`.
   * `'private'` → mine; `'public'` → workspace.
   */
  visibility: z.enum(['private', 'public']).optional(),
});

export type QueryFileListSchemaType = z.infer<typeof QueryFileListSchema>;

export interface QueryFileListParams {
  category?: string;
  knowledgeBaseId?: string;
  limit?: number;
  listScope?: ResourceListScope;
  offset?: number;
  parentId?: string | null;
  q?: string | null;
  showFilesInKnowledgeBase?: boolean;
  sorter?: string;
  sortType?: string;
  visibility?: 'private' | 'public';
}

export interface PaginatedFileList {
  hasMore: boolean;
  items: FileListItem[];
  total?: number;
}
