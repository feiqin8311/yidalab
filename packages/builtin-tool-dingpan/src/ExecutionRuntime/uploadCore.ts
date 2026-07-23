import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parse as parseUrl } from 'node:url';

import {
  buildHtmlDeliverableName,
  type HtmlDeliverableNameInput,
  shanghaiDateParts,
} from './naming';

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

const dentryId = (entry: Json): string => {
  for (const key of ['id', 'uuid', 'dentryUuid'] as const) {
    const value = entry[key];
    if (value) return String(value);
  }
  return '';
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

/**
 * Resolve operator unionId for storage APIs.
 * Prefer explicit DINGTALK_UNION_ID; else map DINGTALK_USER_ID via topapi
 * (oapi topapi/v2/user/get). The new contact/users API often 404s for staff userIds.
 */
export const getUnionId = async (_accessToken?: string): Promise<string> => {
  const unionId = (process.env.DINGTALK_UNION_ID || '').trim();
  if (unionId) return unionId;
  const userId = (process.env.DINGTALK_USER_ID || '').trim();
  if (!userId) throw new Error('DINGTALK_UNION_ID or DINGTALK_USER_ID is required');

  const appKey = (process.env.DINGTALK_APP_KEY || '').trim();
  const appSecret = (process.env.DINGTALK_APP_SECRET || '').trim();
  if (!appKey || !appSecret) {
    throw new Error(
      'DINGTALK_APP_KEY and DINGTALK_APP_SECRET are required to resolve USER_ID → unionId',
    );
  }

  // 1) Prefer oapi topapi — reliable for enterprise staff userid.
  const tokenResp = await fetch(
    `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(appKey)}&appsecret=${encodeURIComponent(appSecret)}`,
  );
  const tokenData = (await tokenResp.json()) as Json;
  if (Number(tokenData.errcode) !== 0 || !tokenData.access_token) {
    throw new Error(`oapi gettoken: ${JSON.stringify(tokenData)}`);
  }
  const oapiToken = String(tokenData.access_token);

  const userResp = await fetch(
    `https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${encodeURIComponent(oapiToken)}`,
    {
      body: JSON.stringify({ language: 'zh_CN', userid: userId }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
  const userData = (await userResp.json()) as Json;
  if (Number(userData.errcode) !== 0) {
    throw new Error(`topapi/v2/user/get: ${JSON.stringify(userData)}`);
  }
  const result = (userData.result || {}) as Json;
  const resolved = String(result.unionid || result.unionId || '').trim();
  if (resolved) return resolved;

  // 2) Fallback: new contact API (works for some tenants / id shapes).
  if (_accessToken) {
    const resp = await fetch(
      `https://api.dingtalk.com/v1.0/contact/users/${encodeURIComponent(userId)}?language=zh_CN`,
      { headers: { 'x-acs-dingtalk-access-token': _accessToken } },
    );
    const data = await jsonResponse(resp, 'contact/users/get');
    const fromContact = String(data.unionId || data.unionid || '').trim();
    if (fromContact) return fromContact;
  }

  throw new Error('USER_ID resolved but unionId missing from user profile');
};

/** List all direct children of a folder (paginated). */
const listDentries = async (input: {
  accessToken: string;
  parentId: string;
  spaceId: string;
  unionId: string;
}): Promise<Json[]> => {
  const items: Json[] = [];
  let nextToken = '';
  for (let page = 0; page < 20; page++) {
    // Build query like curl -G (URLSearchParams). Avoid double-encoding path ids.
    // maxResults>50 intermittently returns HTTP 500 on DingTalk storage API.
    const qs = new URLSearchParams({
      maxResults: '50',
      parentId: input.parentId,
      unionId: input.unionId,
    });
    if (nextToken) qs.set('nextToken', nextToken);
    const url = `https://api.dingtalk.com/v1.0/storage/spaces/${input.spaceId}/dentries?${qs.toString()}`;
    const resp = await fetch(url, {
      headers: { 'x-acs-dingtalk-access-token': input.accessToken },
      method: 'GET',
    });
    const data = await jsonResponse(resp, 'list dentries');
    const raw = data.dentries;
    if (Array.isArray(raw)) items.push(...(raw as Json[]));
    else if (raw && typeof raw === 'object') items.push(raw as Json);
    nextToken = String(data.nextToken || '').trim();
    if (!nextToken) break;
  }
  return items;
};

const createFolder = async (input: {
  accessToken: string;
  name: string;
  parentId: string;
  spaceId: string;
  unionId: string;
}): Promise<{ id: string; name: string }> => {
  const url = new URL(
    `https://api.dingtalk.com/v1.0/storage/spaces/${encodeURIComponent(input.spaceId)}/dentries/${encodeURIComponent(input.parentId)}/folders`,
  );
  url.searchParams.set('unionId', input.unionId);
  const resp = await fetch(url, {
    body: JSON.stringify({ name: input.name }),
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': input.accessToken,
    },
    method: 'POST',
  });
  const data = await jsonResponse(resp, 'create folder');
  const dentry = (data.dentry || data) as Json;
  const id = dentryId(dentry);
  if (!id) throw new Error(`create folder missing id: ${JSON.stringify(data)}`);
  return { id, name: String(dentry.name || input.name).trim() };
};

/**
 * Find exact folder name `YYYY-MM-DD` among siblings.
 * Prefer exact match; never treat `YYYY-MM-DD(1)` as the canonical day folder.
 */
const findExactChildFolderId = (children: Json[], folderName: string): string | undefined => {
  for (const entry of children) {
    if (String(entry.type || '').toUpperCase() !== 'FOLDER') continue;
    if (String(entry.name || '').trim() !== folderName) continue;
    const id = dentryId(entry);
    if (id) return id;
  }
  return undefined;
};

/** Process-local cache: avoid double-create in the same Node process. */
const dateFolderCache = new Map<string, string>();

/**
 * Under parent folder, ensure a `YYYY-MM-DD` child exists (Asia/Shanghai) and return its id.
 *
 * Rules:
 * - If exact `YYYY-MM-DD` already exists → **reuse only** (never create again).
 * - List must succeed before create (list failure must not create — DingTalk renames
 *   collisions to `YYYY-MM-DD(1)` / `(2)` which is what we want to avoid).
 * - If create is renamed by DingTalk, re-list and still prefer the exact name.
 */
export const ensureDateSubfolder = async (input: {
  accessToken: string;
  parentFolderId: string;
  spaceId: string;
  unionId: string;
  date?: Date;
}): Promise<{ folderId: string; folderName: string }> => {
  const { folder: folderName } = shanghaiDateParts(input.date);
  const cacheKey = `${input.spaceId}:${input.parentFolderId}:${folderName}`;
  const cached = dateFolderCache.get(cacheKey);
  if (cached) return { folderId: cached, folderName };

  const loadChildren = async (): Promise<Json[]> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await listDentries({
          accessToken: input.accessToken,
          parentId: input.parentFolderId,
          spaceId: input.spaceId,
          unionId: input.unionId,
        });
      } catch (error) {
        lastError = error;
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`list date folders failed: ${String(lastError)}`);
  };

  // 1) List first — required. If list fails, throw (do not create blind duplicates).
  const children = await loadChildren();
  const existing = findExactChildFolderId(children, folderName);
  if (existing) {
    dateFolderCache.set(cacheKey, existing);
    return { folderId: existing, folderName };
  }

  // 2) No exact folder → create once.
  try {
    const created = await createFolder({
      accessToken: input.accessToken,
      name: folderName,
      parentId: input.parentFolderId,
      spaceId: input.spaceId,
      unionId: input.unionId,
    });
    // DingTalk renames to `2026-07-23(1)` when exact name already exists.
    if (created.name !== folderName) {
      const again = await loadChildren();
      const exact = findExactChildFolderId(again, folderName);
      if (exact) {
        dateFolderCache.set(cacheKey, exact);
        return { folderId: exact, folderName };
      }
    }
    dateFolderCache.set(cacheKey, created.id);
    return { folderId: created.id, folderName };
  } catch (error) {
    // Race: another upload created it — re-list exact name only.
    const again = await loadChildren();
    const raced = findExactChildFolderId(again, folderName);
    if (raced) {
      dateFolderCache.set(cacheKey, raced);
      return { folderId: raced, folderName };
    }
    throw error;
  }
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
  /** Nest under YYYY-MM-DD (default true). */
  useDateSubfolder?: boolean;
  spaceId?: string;
}) => {
  const name = input.name.trim() || 'report.html';
  const size = Buffer.byteLength(input.body);
  if (size === 0) throw new Error('empty file body');
  const resolved = resolveFolderTarget(input);
  const accessToken = await getAccessToken();
  const unionId = await getUnionId(accessToken);

  let folderId = resolved.folderId;
  let dateFolder: string | undefined;
  if (input.useDateSubfolder !== false) {
    const ensured = await ensureDateSubfolder({
      accessToken,
      parentFolderId: resolved.folderId,
      spaceId: resolved.spaceId,
      unionId,
    });
    folderId = ensured.folderId;
    dateFolder = ensured.folderName;
  }

  const { spaceId } = resolved;
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
    dateFolder,
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

export const uploadHtmlToDingpan = async (
  input: {
    folderId?: string;
    folderLink?: string;
    html: string;
    spaceId?: string;
    /** Full remote name override. Prefer structured fields when omitted. */
    uploadName?: string;
    useDateSubfolder?: boolean;
  } & HtmlDeliverableNameInput,
) => {
  const html = input.html?.trim();
  if (!html) throw new Error('html content is required');

  let safeName = input.uploadName?.trim();
  if (safeName) {
    if (!safeName.toLowerCase().endsWith('.html')) safeName = `${safeName}.html`;
  } else {
    safeName = buildHtmlDeliverableName({
      asin: input.asin,
      keyword: input.keyword,
      productName: input.productName,
      site: input.site,
      taskType: input.taskType,
      userName: input.userName,
    });
  }

  return uploadBytesToDingpan({
    body: Buffer.from(html, 'utf8'),
    folderId: input.folderId,
    folderLink: input.folderLink,
    name: safeName,
    spaceId: input.spaceId,
    useDateSubfolder: input.useDateSubfolder,
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
