import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parse as parseUrl } from 'node:url';

type Json = Record<string, unknown>;

const jsonResponse = async (resp: Response, label: string): Promise<Json> => {
  let data: Json;
  try {
    data = (await resp.json()) as Json;
  } catch {
    const text = await resp.text();
    throw new Error(`${label}: HTTP ${resp.status}, non-json: ${text.slice(0, 300)}`);
  }
  if (!resp.ok) throw new Error(`${label}: HTTP ${resp.status}: ${JSON.stringify(data)}`);
  return data;
};

export const resolveFolderTarget = (input: {
  folderId?: string;
  folderLink?: string;
  spaceId?: string;
}): { folderId: string; spaceId: string } => {
  const folderLink = input.folderLink?.trim() || process.env.DINGTALK_FOLDER_LINK?.trim() || '';
  if (folderLink) {
    const parsed = parseUrl(folderLink, true);
    const spaceId = String(parsed.query.spaceId || '').trim();
    const folderId = String(parsed.query.fileId || '').trim();
    const type = String(parsed.query.type || '')
      .trim()
      .toLowerCase();
    if (!spaceId || !folderId) {
      throw new Error('folder link must contain spaceId and fileId');
    }
    if (type && type !== 'folder') {
      throw new Error(`folder link type must be folder, got: ${type}`);
    }
    return { folderId, spaceId };
  }

  const spaceId = (input.spaceId || process.env.DINGTALK_SPACE_ID || '').trim();
  const folderId = (input.folderId || process.env.DINGTALK_FOLDER_ID || '').trim();
  if (!spaceId || !folderId) {
    throw new Error(
      'Missing target folder: set DINGTALK_FOLDER_LINK (credential/env) or pass folderLink / spaceId+folderId',
    );
  }
  return { folderId, spaceId };
};

export const getAccessToken = async (): Promise<string> => {
  const appKey = (process.env.DINGTALK_APP_KEY || '').trim();
  const appSecret = (process.env.DINGTALK_APP_SECRET || '').trim();
  if (!appKey || !appSecret) {
    throw new Error('DINGTALK_APP_KEY and DINGTALK_APP_SECRET are required');
  }
  const resp = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    body: JSON.stringify({ appKey, appSecret }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const data = await jsonResponse(resp, 'oauth2/accessToken');
  const token = String(data.accessToken || '').trim();
  if (!token) throw new Error('oauth2/accessToken: missing accessToken');
  return token;
};

export const getUnionId = async (accessToken: string): Promise<string> => {
  const unionId = (process.env.DINGTALK_UNION_ID || '').trim();
  if (unionId) return unionId;
  const userId = (process.env.DINGTALK_USER_ID || '').trim();
  if (!userId) throw new Error('DINGTALK_UNION_ID or DINGTALK_USER_ID is required');

  const resp = await fetch(
    `https://api.dingtalk.com/v1.0/contact/users/${encodeURIComponent(userId)}?language=zh_CN`,
    { headers: { 'x-acs-dingtalk-access-token': accessToken } },
  );
  const data = await jsonResponse(resp, 'contact/users/get');
  const resolved = String(data.unionId || '').trim();
  if (!resolved) throw new Error('contact/users/get: missing unionId');
  return resolved;
};

const queryUploadInfo = async (input: {
  accessToken: string;
  folderId: string;
  name: string;
  size: number;
  spaceId: string;
  unionId: string;
}) => {
  const url = `https://api.dingtalk.com/v1.0/storage/spaces/${encodeURIComponent(input.spaceId)}/files/uploadInfos/query?unionId=${encodeURIComponent(input.unionId)}`;
  const resp = await fetch(url, {
    body: JSON.stringify({
      fileName: input.name,
      fileSize: input.size,
      multipart: false,
      parentId: input.folderId,
      protocol: 'HEADER_SIGNATURE',
    }),
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': input.accessToken,
    },
    method: 'POST',
  });
  return jsonResponse(resp, 'uploadInfos/query');
};

const putToOss = async (
  ossUrl: string,
  headers: Record<string, string>,
  body: Buffer | Uint8Array,
) => {
  const resp = await fetch(ossUrl, {
    body: Buffer.from(body),
    headers,
    method: 'PUT',
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OSS PUT failed: HTTP ${resp.status} ${text.slice(0, 300)}`);
  }
};

const commitDentry = async (input: {
  accessToken: string;
  folderId: string;
  name: string;
  spaceId: string;
  unionId: string;
  uploadKey: string;
}) => {
  const url = `https://api.dingtalk.com/v1.0/storage/spaces/${encodeURIComponent(input.spaceId)}/files/commit?unionId=${encodeURIComponent(input.unionId)}`;
  const resp = await fetch(url, {
    body: JSON.stringify({
      name: input.name,
      parentId: input.folderId,
      uploadKey: input.uploadKey,
    }),
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': input.accessToken,
    },
    method: 'POST',
  });
  return jsonResponse(resp, 'files/commit');
};

export const extractFileId = (commit: Json): string => {
  const dentry = (commit.dentry || {}) as Json;
  for (const key of ['id', 'uuid', 'dentryUuid'] as const) {
    const value = dentry[key] ?? commit[key];
    if (value) return String(value);
  }
  return '';
};

export const buildPreviewUrl = (spaceId: string, fileId: string) =>
  `https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=${encodeURIComponent(spaceId)}&fileId=${encodeURIComponent(fileId)}&type=file`;

export const uploadBytesToDingpan = async (input: {
  body: Buffer | Uint8Array;
  folderId?: string;
  folderLink?: string;
  name: string;
  spaceId?: string;
}) => {
  const name = input.name.trim() || 'report.html';
  const size = Buffer.byteLength(input.body);
  if (size === 0) throw new Error('empty file body');
  const { spaceId, folderId } = resolveFolderTarget(input);
  const accessToken = await getAccessToken();
  const unionId = await getUnionId(accessToken);
  const info = await queryUploadInfo({
    accessToken,
    folderId,
    name,
    size,
    spaceId,
    unionId,
  });
  const uploadKey = String(info.uploadKey || '');
  const headerInfo = (info.headerSignatureInfo || {}) as Json;
  const resourceUrls = (headerInfo.resourceUrls || []) as string[];
  const ossHeaders = (headerInfo.headers || {}) as Record<string, string>;
  if (!uploadKey || resourceUrls.length === 0) {
    throw new Error(`unexpected uploadInfos/query response: ${JSON.stringify(info)}`);
  }
  await putToOss(resourceUrls[0], ossHeaders, input.body);
  const commit = await commitDentry({
    accessToken,
    folderId,
    name,
    spaceId,
    unionId,
    uploadKey,
  });
  const fileId = extractFileId(commit);
  return {
    fileId,
    name,
    previewUrl: fileId ? buildPreviewUrl(spaceId, fileId) : '',
    spaceId,
  };
};

export const uploadFileToDingpan = async (input: {
  filePath: string;
  folderId?: string;
  folderLink?: string;
  spaceId?: string;
  uploadName?: string;
}) => {
  if (!existsSync(input.filePath)) {
    throw new Error(`file not found: ${input.filePath}`);
  }
  const name = input.uploadName?.trim() || basename(input.filePath);
  const body = readFileSync(input.filePath);
  return uploadBytesToDingpan({
    body,
    folderId: input.folderId,
    folderLink: input.folderLink,
    name,
    spaceId: input.spaceId,
  });
};

export const uploadHtmlToDingpan = async (input: {
  folderId?: string;
  folderLink?: string;
  html: string;
  spaceId?: string;
  uploadName?: string;
}) => {
  const html = input.html?.trim();
  if (!html) throw new Error('html content is required');
  const stamp = new Date()
    .toISOString()
    .replaceAll(/[-:TZ.]/g, '')
    .slice(0, 14);
  const name = input.uploadName?.trim() || `report-${stamp}.html`;
  const safeName = name.toLowerCase().endsWith('.html') ? name : `${name}.html`;
  return uploadBytesToDingpan({
    body: Buffer.from(html, 'utf8'),
    folderId: input.folderId,
    folderLink: input.folderLink,
    name: safeName,
    spaceId: input.spaceId,
  });
};

export const dingpanConfigStatus = () => {
  const hasAppCreds = Boolean(
    process.env.DINGTALK_APP_KEY?.trim() && process.env.DINGTALK_APP_SECRET?.trim(),
  );
  const hasUnionOrUser = Boolean(
    process.env.DINGTALK_UNION_ID?.trim() || process.env.DINGTALK_USER_ID?.trim(),
  );
  let defaultFolderConfigured: boolean;
  try {
    resolveFolderTarget({});
    defaultFolderConfigured = true;
  } catch {
    defaultFolderConfigured = false;
  }
  return {
    defaultFolderConfigured,
    hasAppCreds,
    hasUnionOrUser,
    ready: hasAppCreds && hasUnionOrUser && defaultFolderConfigured,
  };
};
