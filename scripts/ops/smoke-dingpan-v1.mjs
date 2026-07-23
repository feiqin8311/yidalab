/**
 * v1.0-internal dingpan smoke: company app + each personal folder.
 *
 * Usage (repo root):
 *   node scripts/ops/smoke-dingpan-v1.mjs
 *   node scripts/ops/smoke-dingpan-v1.mjs --members 柯鹏翔,李梦,Kevin
 *   node scripts/ops/smoke-dingpan-v1.mjs --dry-run   # token + unionId + list only, no upload
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, parse as parseUrl } from 'node:url';

import pg from 'pg';

const { dirname, join } = path;

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const membersArg = args.find((a) => a.startsWith('--members='))?.slice('--members='.length);
const membersIdx = args.indexOf('--members');
const membersFilter =
  membersArg ||
  (membersIdx >= 0 ? args[membersIdx + 1] : null)
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const loadEnvFile = (path) => {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
};

const env = { ...loadEnvFile(join(root, '.env')), ...process.env };
const DATABASE_URL = env.DATABASE_URL?.replaceAll(/^['"]|['"]$/g, '');
const KEY_VAULTS_SECRET = env.KEY_VAULTS_SECRET?.replaceAll(/^['"]|['"]$/g, '');
if (!DATABASE_URL) throw new Error('DATABASE_URL missing');
if (!KEY_VAULTS_SECRET) throw new Error('KEY_VAULTS_SECRET missing');

const importAesKey = async () => {
  const rawKey = Buffer.from(KEY_VAULTS_SECRET, 'base64');
  return crypto.subtle.importKey('raw', rawKey, { length: 256, name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
};

const decrypt = async (aesKey, packed) => {
  if (!packed) return {};
  const [ivHex, tagHex, dataHex] = packed.split(':');
  if (!ivHex || !tagHex || !dataHex) return {};
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');
  const plain = await crypto.subtle.decrypt(
    { iv, name: 'AES-GCM' },
    aesKey,
    Buffer.concat([encrypted, authTag]),
  );
  return JSON.parse(new TextDecoder().decode(plain));
};

const jsonResponse = async (resp, label) => {
  let data;
  try {
    data = await resp.json();
  } catch {
    const text = await resp.text();
    throw new Error(`${label}: HTTP ${resp.status}, non-json: ${text.slice(0, 300)}`);
  }
  if (!resp.ok) throw new Error(`${label}: HTTP ${resp.status}: ${JSON.stringify(data)}`);
  return data;
};

const getAccessToken = async (appKey, appSecret) => {
  const resp = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    body: JSON.stringify({ appKey, appSecret }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const data = await jsonResponse(resp, 'oauth2/accessToken');
  const token = String(data.accessToken || '').trim();
  if (!token) throw new Error('missing accessToken');
  return token;
};

const parseFolderLink = (folderLink) => {
  const parsed = parseUrl(folderLink, true);
  const spaceId = String(parsed.query.spaceId || '').trim();
  const folderId = String(parsed.query.fileId || '').trim();
  if (!spaceId || !folderId) throw new Error('folder link missing spaceId/fileId');
  return { spaceId, folderId };
};

const shanghaiDate = () => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA → YYYY-MM-DD
  return fmt.format(new Date());
};

const listDentries = async ({ accessToken, spaceId, parentId, unionId }) => {
  const qs = new URLSearchParams({
    maxResults: '50',
    parentId,
    unionId,
  });
  const url = `https://api.dingtalk.com/v1.0/storage/spaces/${spaceId}/dentries?${qs}`;
  const resp = await fetch(url, {
    headers: { 'x-acs-dingtalk-access-token': accessToken },
  });
  const data = await jsonResponse(resp, 'list dentries');
  return Array.isArray(data.dentries) ? data.dentries : [];
};

const ensureDateFolder = async ({ accessToken, spaceId, parentId, unionId, folderName }) => {
  const children = await listDentries({ accessToken, spaceId, parentId, unionId });
  const exact = children.find(
    (e) =>
      String(e.type || '').toUpperCase() === 'FOLDER' && String(e.name || '').trim() === folderName,
  );
  if (exact) {
    const id = String(exact.id || exact.uuid || exact.dentryUuid || '');
    if (id) return { folderId: id, created: false };
  }
  const url = new URL(
    `https://api.dingtalk.com/v1.0/storage/spaces/${encodeURIComponent(spaceId)}/dentries/${encodeURIComponent(parentId)}/folders`,
  );
  url.searchParams.set('unionId', unionId);
  const resp = await fetch(url, {
    body: JSON.stringify({ name: folderName }),
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': accessToken,
    },
    method: 'POST',
  });
  const data = await jsonResponse(resp, 'create folder');
  const dentry = data.dentry || data;
  const id = String(dentry.id || dentry.uuid || dentry.dentryUuid || '');
  if (!id) throw new Error(`create folder no id: ${JSON.stringify(data)}`);
  return { folderId: id, created: true, name: String(dentry.name || folderName) };
};

const uploadHtml = async ({ accessToken, spaceId, folderId, unionId, name, body }) => {
  const size = Buffer.byteLength(body);
  const queryUrl = `https://api.dingtalk.com/v1.0/storage/spaces/${encodeURIComponent(spaceId)}/files/uploadInfos/query?unionId=${encodeURIComponent(unionId)}`;
  const infoResp = await fetch(queryUrl, {
    body: JSON.stringify({
      fileName: name,
      fileSize: size,
      multipart: false,
      parentId: folderId,
      protocol: 'HEADER_SIGNATURE',
    }),
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': accessToken,
    },
    method: 'POST',
  });
  const info = await jsonResponse(infoResp, 'uploadInfos/query');
  const uploadKey = String(info.uploadKey || '').trim();
  const headerSignatureInfo = info.headerSignatureInfo || {};
  const ossUrl = String(
    headerSignatureInfo.resourceUrls?.[0] || headerSignatureInfo.url || '',
  ).trim();
  const headers = headerSignatureInfo.headers || {};
  if (!uploadKey || !ossUrl) throw new Error(`bad upload info: ${JSON.stringify(info)}`);

  const put = await fetch(ossUrl, {
    body,
    headers,
    method: 'PUT',
  });
  if (!put.ok) {
    throw new Error(`OSS PUT HTTP ${put.status}: ${(await put.text()).slice(0, 200)}`);
  }

  const commitUrl = `https://api.dingtalk.com/v1.0/storage/spaces/${encodeURIComponent(spaceId)}/files/commit?unionId=${encodeURIComponent(unionId)}`;
  const commitResp = await fetch(commitUrl, {
    body: JSON.stringify({ name, parentId: folderId, uploadKey }),
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': accessToken,
    },
    method: 'POST',
  });
  const commit = await jsonResponse(commitResp, 'files/commit');
  const dentry = commit.dentry || {};
  const fileId = String(dentry.id || dentry.uuid || dentry.dentryUuid || commit.id || '');
  if (!fileId) throw new Error(`commit missing fileId: ${JSON.stringify(commit)}`);
  const previewUrl = `https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=${encodeURIComponent(spaceId)}&fileId=${encodeURIComponent(fileId)}&type=file`;
  return { fileId, previewUrl, name };
};

const aesKey = await importAesKey();
const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 20_000 });
await client.connect();

const report = {
  at: new Date().toISOString(),
  dryRun,
  company: null,
  token: null,
  members: [],
};

// Company app
const { rows: companyRows } = await client.query(
  `SELECT id, values_encrypted FROM user_credentials WHERE key = 'dingtalk' AND workspace_id IS NOT NULL LIMIT 1`,
);
if (!companyRows[0]) {
  report.company = { ok: false, error: 'company credential dingtalk not found' };
  console.log(JSON.stringify(report, null, 2));
  await client.end();
  process.exit(1);
}
const companyVals = await decrypt(aesKey, companyRows[0].values_encrypted);
const appKey = companyVals.DINGTALK_APP_KEY?.trim() || '';
const appSecret = companyVals.DINGTALK_APP_SECRET?.trim() || '';
const operatorUnionId = companyVals.DINGTALK_UNION_ID?.trim() || '';
report.company = {
  ok: Boolean(appKey && appSecret),
  id: companyRows[0].id,
  appKeyPrefix: appKey.slice(0, 8),
  hasSecret: Boolean(appSecret),
  operatorUnionId: operatorUnionId ? `${operatorUnionId.slice(0, 6)}…` : null,
};
if (!report.company.ok) {
  report.company.error = 'missing APP_KEY or APP_SECRET';
  console.log(JSON.stringify(report, null, 2));
  await client.end();
  process.exit(1);
}

let accessToken;
try {
  accessToken = await getAccessToken(appKey, appSecret);
  report.token = { ok: true };
} catch (e) {
  report.token = { ok: false, error: String(e.message || e) };
  console.log(JSON.stringify(report, null, 2));
  await client.end();
  process.exit(1);
}

// Personal members
const { rows: personalRows } = await client.query(
  `SELECT c.id, c.values_encrypted, u.username, u.id AS user_id
   FROM user_credentials c
   JOIN users u ON u.id = c.user_id
   WHERE c.key = 'dingtalk-dingpan' AND c.workspace_id IS NULL
   ORDER BY u.username`,
);

const dateName = shanghaiDate();
const toTest = personalRows.filter((r) => {
  if (!membersFilter?.length) return true;
  return membersFilter.some(
    (m) => r.username === m || r.username?.toLowerCase() === m.toLowerCase(),
  );
});

// Prefer 3 diverse accounts if no filter: pick first 3 that look complete, else all
let targets = toTest;
if (!membersFilter?.length && toTest.length > 3) {
  // Prefer 柯鹏翔 + two others if present
  const prefer = ['柯鹏翔', '李梦', 'Kevin', '邱文杰', '柯芦轩', 'jasmin'];
  const picked = [];
  for (const name of prefer) {
    const row = toTest.find(
      (r) => r.username === name || r.username?.toLowerCase() === name.toLowerCase(),
    );
    if (row && !picked.includes(row)) picked.push(row);
    if (picked.length >= 3) break;
  }
  targets = picked.length >= 3 ? picked : toTest.slice(0, 3);
}

for (const row of targets) {
  const entry = {
    username: row.username,
    userId: row.user_id,
    steps: {},
  };
  try {
    const vals = await decrypt(aesKey, row.values_encrypted);
    const folderLink = vals.DINGTALK_FOLDER_LINK?.trim() || '';
    const personalUnionLeak = vals.DINGTALK_UNION_ID?.trim() || '';
    const userIdCred = vals.DINGTALK_USER_ID?.trim() || '';
    const hasAppKeyLeak = Boolean(
      vals.DINGTALK_APP_KEY?.trim() || vals.DINGTALK_APP_SECRET?.trim(),
    );

    entry.steps.creds = {
      ok: Boolean(folderLink),
      folderLink: Boolean(folderLink),
      userId: Boolean(userIdCred),
      noAppKeyLeak: !hasAppKeyLeak,
      noPersonalUnionOverride: !personalUnionLeak,
    };
    if (hasAppKeyLeak) entry.steps.creds.warning = 'personal row still has APP_KEY/SECRET';
    if (personalUnionLeak) {
      entry.steps.creds.warning =
        (entry.steps.creds.warning ? `${entry.steps.creds.warning}; ` : '') +
        'personal UNION_ID would override company operator — strip it';
    }
    if (!entry.steps.creds.ok) {
      entry.ok = false;
      entry.error = 'incomplete personal creds (need FOLDER_LINK)';
      report.members.push(entry);
      continue;
    }

    const { spaceId, folderId: parentFolderId } = parseFolderLink(folderLink);
    entry.steps.folderParse = { ok: true, spaceId, parentFolderId };

    // Operator: company UNION_ID (space writer). Do not use personal staff union.
    let unionId;
    try {
      if (!operatorUnionId) throw new Error('company DINGTALK_UNION_ID (operator) missing');
      unionId = operatorUnionId;
      entry.steps.unionId = { ok: true, operator: `${unionId.slice(0, 6)}…` };
    } catch (e) {
      entry.steps.unionId = { ok: false, error: String(e.message || e) };
      entry.ok = false;
      report.members.push(entry);
      continue;
    }

    try {
      await listDentries({
        accessToken,
        spaceId,
        parentId: parentFolderId,
        unionId,
      });
      entry.steps.listParent = { ok: true };
    } catch (e) {
      entry.steps.listParent = { ok: false, error: String(e.message || e) };
      entry.ok = false;
      report.members.push(entry);
      continue;
    }

    let dateFolderId;
    try {
      const ensured = await ensureDateFolder({
        accessToken,
        spaceId,
        parentId: parentFolderId,
        unionId,
        folderName: dateName,
      });
      dateFolderId = ensured.folderId;
      entry.steps.dateFolder = {
        ok: true,
        name: dateName,
        folderId: dateFolderId,
        created: ensured.created,
      };
    } catch (e) {
      entry.steps.dateFolder = { ok: false, error: String(e.message || e) };
      entry.ok = false;
      report.members.push(entry);
      continue;
    }

    if (dryRun) {
      entry.steps.upload = { skipped: true, dryRun: true };
      entry.ok = true;
      report.members.push(entry);
      continue;
    }

    const safeName = String(row.username || 'user').replaceAll(/[^\w\u4E00-\u9FFF-]/g, '_');
    const fileName = `SMOKE_v1_${safeName}_${dateName.replaceAll('-', '')}.html`;
    const html = Buffer.from(
      `<!doctype html><meta charset="utf-8"><title>YidaLab v1 smoke</title>` +
        `<h1>YidaLab v1.0-internal smoke</h1><p>user=${row.username}</p><p>at=${new Date().toISOString()}</p>`,
      'utf8',
    );

    try {
      const uploaded = await uploadHtml({
        accessToken,
        spaceId,
        folderId: dateFolderId,
        unionId,
        name: fileName,
        body: html,
      });
      entry.steps.upload = {
        ok: true,
        name: uploaded.name,
        fileId: uploaded.fileId,
        previewUrl: uploaded.previewUrl,
      };
      entry.ok = true;
    } catch (e) {
      entry.steps.upload = { ok: false, error: String(e.message || e) };
      entry.ok = false;
    }
  } catch (e) {
    entry.ok = false;
    entry.error = String(e.message || e);
  }
  report.members.push(entry);
}

await client.end();

const passed = report.members.filter((m) => m.ok).length;
const failed = report.members.filter((m) => !m.ok).length;
report.summary = {
  tested: report.members.length,
  passed,
  failed,
  gate: failed === 0 && passed >= 1 ? 'PASS' : 'FAIL',
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.summary.gate === 'PASS' ? 0 : 1);
