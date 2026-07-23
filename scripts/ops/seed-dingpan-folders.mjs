/**
 * Seed company DingTalk app credential + personal dingtalk-dingpan folders.
 *
 * Usage (from repo root):
 *   DINGTALK_APP_KEY=... DINGTALK_APP_SECRET=... node scripts/ops/seed-dingpan-folders.mjs
 *
 * Reads:
 *   - .env → DATABASE_URL, KEY_VAULTS_SECRET
 *   - tools/dingpan/.env or env for APP_KEY/SECRET (company vault only)
 *   - scripts/ops/dingpan-personal-folders.json (personal folder + dingtalkUserId)
 *
 * Company credential key: `dingtalk` (APP_KEY + APP_SECRET)
 * Personal credential key: `dingtalk-dingpan` (USER_ID/UNION_ID + FOLDER_LINK only)
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { dirname, join } = path;
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');

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
const dingpanEnv = loadEnvFile(join(root, '../tools/dingpan/.env'));

const DATABASE_URL = env.DATABASE_URL?.replaceAll(/^['"]|['"]$/g, '');
const KEY_VAULTS_SECRET = env.KEY_VAULTS_SECRET?.replaceAll(/^['"]|['"]$/g, '');
if (!DATABASE_URL) throw new Error('DATABASE_URL missing');
if (!KEY_VAULTS_SECRET) throw new Error('KEY_VAULTS_SECRET missing');

// Explicit process.env wins (ops override); then tools/dingpan/.env; then root .env.
// UNION_ID on company = space **operator** (must be able to write every member folder).
const COMPANY_APP = {
  DINGTALK_APP_KEY:
    process.env.DINGTALK_APP_KEY || dingpanEnv.DINGTALK_APP_KEY || env.DINGTALK_APP_KEY || '',
  DINGTALK_APP_SECRET:
    process.env.DINGTALK_APP_SECRET ||
    dingpanEnv.DINGTALK_APP_SECRET ||
    env.DINGTALK_APP_SECRET ||
    '',
  DINGTALK_UNION_ID:
    process.env.DINGTALK_UNION_ID || dingpanEnv.DINGTALK_UNION_ID || env.DINGTALK_UNION_ID || '',
};

const map = JSON.parse(readFileSync(join(__dirname, 'dingpan-personal-folders.json'), 'utf8'));

/** Same AES-GCM format as KeyVaultsGateKeeper */
const importAesKey = async () => {
  const rawKey = Buffer.from(KEY_VAULTS_SECRET, 'base64');
  return crypto.subtle.importKey('raw', rawKey, { length: 256, name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
};

const encrypt = async (aesKey, plaintext) => {
  const iv = randomBytes(12);
  const encoded = new TextEncoder().encode(plaintext);
  const encryptedData = Buffer.from(
    await crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, aesKey, encoded),
  );
  const authTag = encryptedData.subarray(-16);
  const encrypted = encryptedData.subarray(0, -16);
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

const decrypt = async (aesKey, packed) => {
  if (!packed) return {};
  const [ivHex, tagHex, dataHex] = packed.split(':');
  if (!ivHex || !tagHex || !dataHex) return {};
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');
  const combined = Buffer.concat([encrypted, authTag]);
  const plain = await crypto.subtle.decrypt({ iv, name: 'AES-GCM' }, aesKey, combined);
  return JSON.parse(new TextDecoder().decode(plain));
};

const maskPreview = (values) => {
  const first = Object.values(values).find((v) => typeof v === 'string' && v.length > 0);
  if (!first) return null;
  if (first.length <= 8) return '****';
  return `${first.slice(0, 4)}****${first.slice(-4)}`;
};

const NAME_ALIASES = {
  Jasmin: ['Jasmin', 'jasmin'],
  Kevin: ['Kevin', 'kevin'],
  柯鹏翔: ['柯鹏翔'],
  柯芦轩: ['柯芦轩'],
  邱文杰: ['邱文杰'],
  李梦: ['李梦'],
};

const aesKey = await importAesKey();
const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 20_000 });
await client.connect();

const results = { company: null, members: [] };

// --- Company shared app credential ---
const { rows: workspaces } = await client.query(
  `SELECT id, name, primary_owner_id FROM workspaces ORDER BY created_at ASC LIMIT 1`,
);
const companyWs = workspaces[0];
if (!companyWs) {
  console.error('No workspace found for company credential seed');
} else if (!COMPANY_APP.DINGTALK_APP_KEY || !COMPANY_APP.DINGTALK_APP_SECRET) {
  results.company = {
    status: 'skipped_missing_env',
    workspaceId: companyWs.id,
    hint: 'Set DINGTALK_APP_KEY and DINGTALK_APP_SECRET (and DINGTALK_UNION_ID operator)',
  };
} else {
  const { rows: existingCompany } = await client.query(
    `SELECT id, values_encrypted FROM user_credentials
     WHERE workspace_id = $1 AND key = $2
     LIMIT 1`,
    [companyWs.id, 'dingtalk'],
  );

  const companyValues = {
    DINGTALK_APP_KEY: COMPANY_APP.DINGTALK_APP_KEY,
    DINGTALK_APP_SECRET: COMPANY_APP.DINGTALK_APP_SECRET,
    DINGTALK_UNION_ID: COMPANY_APP.DINGTALK_UNION_ID,
  };
  const encrypted = await encrypt(aesKey, JSON.stringify(companyValues));
  const name = 'DingTalk App';
  const description =
    'Shared enterprise DingTalk app (钉盘 OpenAPI). One APP_KEY/SECRET for the whole company.';
  const preview = maskPreview(companyValues);

  if (existingCompany[0]) {
    await client.query(
      `UPDATE user_credentials
       SET values_encrypted = $1, name = $2, description = $3, masked_preview = $4, updated_at = NOW()
       WHERE id = $5`,
      [encrypted, name, description, preview, existingCompany[0].id],
    );
    results.company = {
      status: 'updated',
      workspaceId: companyWs.id,
      workspaceName: companyWs.name,
      id: existingCompany[0].id,
    };
  } else {
    const { rows: inserted } = await client.query(
      `INSERT INTO user_credentials
        (user_id, workspace_id, key, name, description, type, values_encrypted, masked_preview, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'kv-env', $6, $7, NOW(), NOW())
       RETURNING id`,
      [companyWs.primary_owner_id, companyWs.id, 'dingtalk', name, description, encrypted, preview],
    );
    results.company = {
      status: 'created',
      workspaceId: companyWs.id,
      workspaceName: companyWs.name,
      id: inserted[0].id,
    };
  }
}

// --- Personal folder + identity (no APP_KEY/SECRET) ---
for (const member of map.members) {
  const aliases = NAME_ALIASES[member.displayName] || [member.displayName];
  const { rows: users } = await client.query(
    `SELECT id, username, email FROM users WHERE username = ANY($1::text[]) LIMIT 5`,
    [aliases],
  );
  if (users.length === 0) {
    results.members.push({ displayName: member.displayName, status: 'user_not_found' });
    continue;
  }
  const user = users[0];

  const { rows: existing } = await client.query(
    `SELECT id, values_encrypted, name FROM user_credentials
     WHERE user_id = $1 AND key = $2 AND workspace_id IS NULL
     LIMIT 1`,
    [user.id, 'dingtalk-dingpan'],
  );

  let values = {};
  if (existing[0]?.values_encrypted) {
    try {
      values = await decrypt(aesKey, existing[0].values_encrypted);
    } catch (e) {
      console.warn('decrypt failed for', user.username, e.message);
      values = {};
    }
  }

  // Personal = folder (+ optional staff userId for debug). Operator UNION_ID
  // lives on company credential so list/upload can write every member folder.
  const next = {
    DINGTALK_USER_ID: member.dingtalkUserId
      ? String(member.dingtalkUserId)
      : values.DINGTALK_USER_ID || '',
    DINGTALK_FOLDER_LINK: member.folderLink,
  };

  const encrypted = await encrypt(aesKey, JSON.stringify(next));
  const name = 'DingTalk';
  const description = `Personal 钉盘 folder for ${member.displayName} (app secret is company dingtalk)`;
  const preview = maskPreview(next);

  if (existing[0]) {
    await client.query(
      `UPDATE user_credentials
       SET values_encrypted = $1, name = $2, description = $3, masked_preview = $4, updated_at = NOW()
       WHERE id = $5`,
      [encrypted, name, description, preview, existing[0].id],
    );
    results.members.push({
      displayName: member.displayName,
      folderId: member.folderId,
      status: 'updated',
      userId: user.id,
      username: user.username,
    });
  } else {
    await client.query(
      `INSERT INTO user_credentials
        (user_id, workspace_id, key, name, description, type, values_encrypted, masked_preview, created_at, updated_at)
       VALUES ($1, NULL, $2, $3, $4, 'kv-env', $5, $6, NOW(), NOW())`,
      [user.id, 'dingtalk-dingpan', name, description, encrypted, preview],
    );
    results.members.push({
      displayName: member.displayName,
      folderId: member.folderId,
      status: 'created',
      userId: user.id,
      username: user.username,
    });
  }
}

console.log(JSON.stringify(results, null, 2));
await client.end();
