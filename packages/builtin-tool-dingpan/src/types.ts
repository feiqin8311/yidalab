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

export interface UploadToDingpanState {
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
