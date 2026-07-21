export const DingpanIdentifier = 'lobe-dingpan';

/**
 * Personal credential key (kv-env) under Settings → Credentials.
 * Each user fills their own folder path / identity; runtime injects these into env.
 */
export const DingpanPersonalCredKey = 'dingtalk-dingpan';

/** Template keys for the personal dingpan credential form (values left empty for the user). */
export const DingpanPersonalCredEnvKeys = [
  'DINGTALK_APP_KEY',
  'DINGTALK_APP_SECRET',
  'DINGTALK_UNION_ID',
  'DINGTALK_FOLDER_LINK',
] as const;

export const DingpanApiName = {
  uploadToDingpan: 'uploadToDingpan',
  uploadHtmlToDingpan: 'uploadHtmlToDingpan',
  dingpanStatus: 'dingpanStatus',
} as const;

export type DingpanApiNameType = (typeof DingpanApiName)[keyof typeof DingpanApiName];

export interface UploadToDingpanParams {
  /** Absolute path to a local file on the execution host (device or server). */
  filePath: string;
  /** With spaceId: override default folder for this upload. */
  folderId?: string;
  /**
   * DingTalk Drive folder link for THIS upload only.
   * Overrides credential / env default folder.
   * Example: https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=...&fileId=...&type=folder
   */
  folderLink?: string;
  /** With folderId: override default folder for this upload. */
  spaceId?: string;
  /** Remote file name. Defaults to local basename. */
  uploadName?: string;
}

export interface UploadHtmlToDingpanParams {
  /**
   * Optional persisted document id (must belong to the current user).
   * When set, content is loaded from documents and dingpan metadata is written back.
   */
  documentId?: string;
  /** With spaceId: override default folder for this upload. */
  folderId?: string;
  /** Optional folder link override for this upload. */
  folderLink?: string;
  /**
   * Full HTML document string. Required when documentId is omitted;
   * used as content when creating a new deliverable document.
   */
  html?: string;
  /** With folderId: override default folder for this upload. */
  spaceId?: string;
  /** Title for the persisted document (defaults from uploadName). */
  title?: string;
  /** Topic to associate the deliverable document with (traceability). */
  topicId?: string;
  /** Remote file name. Defaults to report-YYYYMMDDHHmmss.html */
  uploadName?: string;
}

export interface UploadToDingpanState {
  documentId?: string;
  fileId?: string;
  filePath?: string;
  name?: string;
  previewUrl?: string;
  success?: boolean;
}

export interface DingpanStatusParams {
  /** Optional. No parameters required. */
  _?: never;
}

export interface DingpanStatusState {
  defaultFolderConfigured?: boolean;
  hasAppCreds?: boolean;
  hasUnionOrUser?: boolean;
  ready?: boolean;
}
