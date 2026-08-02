export const DingpanIdentifier = 'lobe-dingpan';

/**
 * Company credential key (kv-env): shared enterprise app + space operator.
 * One open-platform app for the whole company — no per-member app registration.
 * DINGTALK_UNION_ID here is the **operator** that can read/write the shared space
 * (personal staff unionIds often 403 on sibling folders).
 */
export const DingpanCompanyCredKey = 'dingtalk';

/** Template keys for the company DingTalk app credential. */
export const DingpanCompanyCredEnvKeys = [
  'DINGTALK_APP_KEY',
  'DINGTALK_APP_SECRET',
  'DINGTALK_UNION_ID',
] as const;

/**
 * Personal credential key (kv-env) under Settings → Credentials.
 * Default folder path only; app + operator live on company `dingtalk`.
 * Optional USER_ID is for display/debug — do not put a personal UNION_ID here
 * (it would override the company operator and break uploads).
 */
export const DingpanPersonalCredKey = 'dingtalk-dingpan';

/** Template keys for the personal dingpan credential form (values left empty for the user). */
export const DingpanPersonalCredEnvKeys = ['DINGTALK_FOLDER_LINK', 'DINGTALK_USER_ID'] as const;

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
  /** ASIN for structured filename, e.g. B0GVDTV1J6 */
  asin?: string;
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
   * Full HTML document string. Required when documentId is omitted.
   * Kept on the tool message as the chat Artifact (not resource library).
   */
  html?: string;
  /** Keyword segment when ASIN is absent. */
  keyword?: string;
  /** Short product name for the filename. */
  productName?: string;
  /** Site / market label, e.g. 日本 / US */
  site?: string;
  /** With folderId: override default folder for this upload. */
  spaceId?: string;
  /** Task short label for the filename, e.g. 推广复盘 */
  taskType?: string;
  /** Display title (does not create a resource document). */
  title?: string;
  /** Topic id for server context / bot fallback association. */
  topicId?: string;
  /**
   * Full remote file name override.
   * Prefer structured fields (asin/site/taskType/…) when omitted.
   * Default pattern: `{ASIN}_{站点}_{任务类型}_{用户名}_{YYYYMMDD}.html`
   * Example: B0GVDTV1J6_日本_推广复盘_柯鹏翔_20260723.html
   */
  uploadName?: string;
  /**
   * Current **human user** display name (not the agent). Server injects this when possible.
   */
  userName?: string;
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
