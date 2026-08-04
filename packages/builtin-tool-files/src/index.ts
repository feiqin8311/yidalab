/**
 * Client-safe package entry. Server-only FilesExecutionRuntime lives at
 * `@lobechat/builtin-tool-files/executionRuntime` — keep it off the root so SPA
 * imports of manifests/types never pull server runtimes.
 */
export { FilesManifest } from './manifest';
export { systemPrompt } from './systemRole';
export {
  FilesApiName,
  type FilesApiNameType,
  FilesIdentifier,
  type InspectAttachmentParams,
  type ReadAttachmentParams,
  type SearchAttachmentParams,
} from './types';
