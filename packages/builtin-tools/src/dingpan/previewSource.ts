import type { DingpanUploadResult } from './parseResult';

export type DingpanPreviewArgs = {
  documentId?: string;
  html?: string;
};

/**
 * Message-level HTML Artifact (tool arguments.html). Preferred over resource docs.
 */
export const resolveArtifactHtml = (args?: DingpanPreviewArgs | null): string =>
  typeof args?.html === 'string' ? args.html.trim() : '';

/**
 * Resolve which document id to fetch for legacy rows that only stored documentId.
 * Empty when message already has HTML.
 */
export const resolveLegacyDocumentId = (
  args: DingpanPreviewArgs | null | undefined,
  result: Pick<DingpanUploadResult, 'documentId'>,
): string => {
  if (resolveArtifactHtml(args)) return '';
  return result.documentId || (typeof args?.documentId === 'string' ? args.documentId.trim() : '');
};

/** Workspace card can open Portal when message HTML or legacy documentId exists. */
export const canWorkspacePreview = (
  args: DingpanPreviewArgs | null | undefined,
  result: Pick<DingpanUploadResult, 'documentId'>,
): boolean => Boolean(resolveArtifactHtml(args) || result.documentId || args?.documentId);
