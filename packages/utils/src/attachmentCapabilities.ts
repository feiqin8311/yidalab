/**
 * Infer attachment tool capabilities from filename / mime.
 * Shared by server + client tool engines for capability-driven tool enablement.
 */

export type AttachmentCapabilityFlags = {
  /** Any non-media document/file attachment present. */
  hasDocument: boolean;
  /** Any spreadsheet-like attachment present. */
  hasSpreadsheet: boolean;
  /** Any file attachment (document or spreadsheet). */
  hasAttachment: boolean;
};

export const isSpreadsheetAttachment = (
  fileType?: string | null,
  name?: string | null,
): boolean => {
  const mime = (fileType || '').toLowerCase();
  const lowerName = (name || '').toLowerCase();
  if (
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    mime.includes('csv') ||
    mime === 'text/csv' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return true;
  }
  return (
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.xls') ||
    lowerName.endsWith('.xlsm') ||
    lowerName.endsWith('.csv')
  );
};

export const isDocumentAttachment = (fileType?: string | null, name?: string | null): boolean => {
  if (isSpreadsheetAttachment(fileType, name)) return false;
  const mime = (fileType || '').toLowerCase();
  const lowerName = (name || '').toLowerCase();
  if (
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime.includes('zip')
  ) {
    return false;
  }
  // Treat remaining files as document-like for lobe-files tools.
  if (
    mime.startsWith('text/') ||
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('document')
  ) {
    return true;
  }
  return Boolean(/\.(?:pdf|docx?|txt|md|rtf|json|xml|html?|pptx?|pages|numbers)$/i.test(lowerName));
};

export const inferAttachmentCapabilities = (
  files: Array<{ fileType?: string | null; name?: string | null }> = [],
): AttachmentCapabilityFlags => {
  let hasDocument = false;
  let hasSpreadsheet = false;
  for (const f of files) {
    if (isSpreadsheetAttachment(f.fileType, f.name)) hasSpreadsheet = true;
    else if (
      isDocumentAttachment(f.fileType, f.name) ||
      (f.name && !isSpreadsheetAttachment(f.fileType, f.name))
    ) {
      // Unknown non-spreadsheet file still may need readAttachment
      hasDocument = true;
    }
  }
  return {
    hasAttachment: hasDocument || hasSpreadsheet,
    hasDocument,
    hasSpreadsheet,
  };
};
