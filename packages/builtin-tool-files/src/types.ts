export const FilesIdentifier = 'lobe-files';

export const FilesApiName = {
  inspectAttachment: 'inspectAttachment',
  readAttachment: 'readAttachment',
  searchAttachment: 'searchAttachment',
} as const;

export type FilesApiNameType = (typeof FilesApiName)[keyof typeof FilesApiName];

export interface InspectAttachmentParams {
  fileId: string;
}

export interface ReadAttachmentParams {
  fileId: string;
  /** Max characters to return (default 4000, max 12000). */
  limit?: number;
  /** Character offset into the extracted text (default 0). */
  offset?: number;
  /**
   * Optional page hint for multi-page documents (1-based). When set, the
   * service attempts to return content from that page slice if available.
   */
  pages?: number[];
}

export interface SearchAttachmentParams {
  fileId: string;
  /** Max match snippets (default 5, max 20). */
  limit?: number;
  query: string;
}
