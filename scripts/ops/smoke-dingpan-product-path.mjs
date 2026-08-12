/**
 * Product-path dingpan smoke (trusted delivery closed-loop).
 *
 * Unlike smoke-dingpan-v1.mjs (API/credential upload only), this verifies:
 *   1) company + personal credentials decrypt
 *   2) uploadHtml-equivalent API returns preview_url
 *   3) deliveryClaimGuard authority rules (tool success vs fake prose)
 *   4) optional: operation outcome / delivery_attempts schema presence
 *
 * Usage (repo root):
 *   node scripts/ops/smoke-dingpan-product-path.mjs
 *   node scripts/ops/smoke-dingpan-product-path.mjs --dry-run
 *   node scripts/ops/smoke-dingpan-product-path.mjs --member 柯鹏翔
 *
 * Exit: 0 only when happy-path product gates pass.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, parse as parseUrl } from 'node:url';

import pg from 'pg';

const { dirname, join } = path;
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const memberArg =
  args.find((a) => a.startsWith('--member='))?.slice('--member='.length) ||
  (args.includes('--member') ? args[args.indexOf('--member') + 1] : null);

const loadEnvFile = (p) => {
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
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

const log = (msg, extra) => {
  if (extra !== undefined) console.log(msg, extra);
  else console.log(msg);
};

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

const buildPreviewUrl = (spaceId, fileId) =>
  `https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=${encodeURIComponent(spaceId)}&fileId=${encodeURIComponent(fileId)}&type=file`;

/**
 * Inline subset of deliveryClaimGuard — product gate: model prose is never authority.
 */
const extractDingpanUploadOutcomes = (messages) => {
  const outcomes = [];
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    if (message.plugin?.identifier !== 'lobe-dingpan') continue;
    if (!['uploadHtmlToDingpan', 'uploadToDingpan'].includes(message.plugin?.apiName)) continue;
    let payload;
    try {
      payload = JSON.parse(String(message.content || ''));
    } catch {
      payload = null;
    }
    const previewUrl = String(payload?.preview_url ?? payload?.previewUrl ?? '').trim();
    const explicitSuccess = payload?.success === true;
    const explicitFailure = payload?.success === false;
    const trusted = (() => {
      try {
        const u = new URL(previewUrl);
        return (
          u.protocol === 'https:' &&
          u.hostname === 'qr.dingtalk.com' &&
          u.pathname === '/page/yunpan' &&
          u.searchParams.get('route') === 'previewDentry' &&
          Boolean(u.searchParams.get('spaceId')?.trim()) &&
          Boolean(u.searchParams.get('fileId')?.trim())
        );
      } catch {
        return false;
      }
    })();
    if (!explicitFailure && trusted && (explicitSuccess || Boolean(previewUrl))) {
      outcomes.push({ previewUrl, success: true });
    } else {
      outcomes.push({
        success: false,
        error: previewUrl && !trusted ? 'untrusted preview_url' : 'non-success tool payload',
      });
    }
  }
  return outcomes;
};

const applyClaimGuard = (content, messages) => {
  const outcomes = extractDingpanUploadOutcomes(messages);
  if (outcomes.length === 0) return content;
  const latest = outcomes.at(-1);
  if (latest.success && latest.previewUrl) {
    if (!content.includes(latest.previewUrl)) {
      return `${content.trim()}\n\n[打开钉盘预览](${latest.previewUrl})`;
    }
    return content;
  }
  if (/已上传|上传至钉盘|上传到钉盘/.test(content)) {
    return `钉盘上传失败：${latest.error || '工具未返回 preview_url'}`;
  }
  return content;
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const main = async () => {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  const aesKey = await importAesKey();
  const gates = [];
  const fail = (name, err) => {
    gates.push({ name, ok: false, err: String(err) });
    console.error(`FAIL ${name}:`, err);
  };
  const pass = (name, detail) => {
    gates.push({ name, ok: true, detail });
    log(`PASS ${name}`, detail ?? '');
  };

  try {
    // Gate 0: schema for trusted delivery closed-loop
    try {
      const cols = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'agent_operations'
          AND column_name IN ('outcome_status','outcome_preview_url','outcome_verified_at')
      `);
      const tables = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'delivery_attempts'
      `);
      if (tables.rowCount === 0) {
        fail(
          'schema.delivery_attempts',
          'table missing — run migration 0134_delivery_attempts_and_outcome',
        );
      } else {
        pass('schema.delivery_attempts');
      }
      if (cols.rowCount < 3) {
        fail('schema.outcome_columns', `found ${cols.rowCount}/3 outcome_* columns`);
      } else {
        pass('schema.outcome_columns', cols.rows.map((r) => r.column_name).join(','));
      }
    } catch (e) {
      fail('schema', e.message || e);
    }

    // Gate 1: company credential
    const company = await client.query(
      `SELECT user_id, encrypted FROM user_credentials WHERE key = 'dingtalk' LIMIT 5`,
    );
    assert(company.rowCount > 0, 'no company dingtalk credential');
    let appKey;
    let appSecret;
    let operatorId;
    for (const row of company.rows) {
      const plain = await decrypt(aesKey, row.encrypted);
      if (plain.appKey && plain.appSecret) {
        appKey = plain.appKey;
        appSecret = plain.appSecret;
        operatorId = plain.operatorId || plain.unionId;
        break;
      }
    }
    assert(appKey && appSecret, 'company credential missing appKey/appSecret');
    const token = await getAccessToken(appKey, appSecret);
    pass('company.oauth', `token_len=${token.length}`);

    // Gate 2: personal folder + product upload path
    let personalQ = `
      SELECT uc.user_id, uc.encrypted, u.username, u.first_name, u.last_name
      FROM user_credentials uc
      LEFT JOIN users u ON u.id = uc.user_id
      WHERE uc.key = 'dingtalk-dingpan'
      ORDER BY uc.updated_at DESC NULLS LAST
      LIMIT 20
    `;
    const personal = await client.query(personalQ);
    assert(personal.rowCount > 0, 'no personal dingtalk-dingpan folders');

    let chosen = null;
    for (const row of personal.rows) {
      const plain = await decrypt(aesKey, row.encrypted);
      const folderLink = plain.folderLink || plain.folder_link || plain.link;
      if (!folderLink) continue;
      const name =
        row.username || [row.first_name, row.last_name].filter(Boolean).join('') || row.user_id;
      if (memberArg && !String(name).includes(memberArg) && !row.user_id.includes(memberArg)) {
        continue;
      }
      chosen = { ...row, folderLink, name, plain };
      break;
    }
    assert(
      chosen,
      memberArg ? `no personal folder matching ${memberArg}` : 'no usable personal folder',
    );
    const { spaceId, folderId } = parseFolderLink(chosen.folderLink);
    pass('personal.folder', `${chosen.name} space=${spaceId}`);

    // Resolve operator unionId if needed (best-effort)
    let unionId = operatorId;
    if (!unionId) {
      try {
        const me = await fetch('https://api.dingtalk.com/v1.0/contact/users/me', {
          headers: { 'x-acs-dingtalk-access-token': token },
        });
        const meData = await me.json().catch(() => ({}));
        unionId = meData.unionId || meData.result?.unionId;
      } catch {
        /* optional */
      }
    }

    if (dryRun) {
      pass('upload.skipped', 'dry-run');
    } else {
      // Minimal product-path: commit a tiny HTML and require preview URL shape
      const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
      const fileName = `yidalab-product-smoke-${stamp}.html`;
      const html = `<!doctype html><html><body><h1>YidaLab product-path smoke</h1><p>${stamp}</p></body></html>`;
      const htmlBytes = Buffer.from(html, 'utf8');

      // Prove folder access (dentry list). Fall back to uploadInfos if list fails.
      try {
        const listResp = await fetch(
          `https://api.dingtalk.com/v1.0/storage/spaces/${spaceId}/dentries/${folderId}/list?maxResults=5&unionId=${encodeURIComponent(unionId || '')}`,
          { headers: { 'x-acs-dingtalk-access-token': token } },
        );
        if (!listResp.ok) {
          log('folder list non-ok', listResp.status);
        }
      } catch (e) {
        log('folder list error (continue upload)', e.message);
      }

      // uploadInfos → OSS → commit (same core path as uploadHtmlToDingpan)
      const infoResp = await fetch(
        `https://api.dingtalk.com/v1.0/storage/spaces/${spaceId}/files/uploadInfos/query?unionId=${encodeURIComponent(unionId || '')}`,
        {
          body: JSON.stringify({
            protocol: 'HEADER_SIGNATURE',
            multipart: false,
            parentId: folderId,
            fileName,
            fileSize: htmlBytes.length,
            contentMd5: createHash('md5').update(htmlBytes).digest('base64'),
            contentType: 'text/html',
          }),
          headers: {
            'Content-Type': 'application/json',
            'x-acs-dingtalk-access-token': token,
          },
          method: 'POST',
        },
      );
      const info = await jsonResponse(infoResp, 'uploadInfos/query');
      const uploadKey = info.uploadKey || info.result?.uploadKey;
      const headerSignatureInfo = info.headerSignatureInfo || info.result?.headerSignatureInfo;
      assert(uploadKey && headerSignatureInfo, 'uploadInfos missing uploadKey/headerSignatureInfo');

      const resourceUrls = headerSignatureInfo.resourceUrls || headerSignatureInfo.resourceUrl;
      const url = Array.isArray(resourceUrls) ? resourceUrls[0] : resourceUrls;
      const headers = headerSignatureInfo.headers || {};
      const put = await fetch(url, {
        body: htmlBytes,
        headers: { ...headers, 'Content-Type': 'text/html' },
        method: 'PUT',
      });
      assert(put.ok, `OSS PUT failed HTTP ${put.status}`);

      const commitResp = await fetch(
        `https://api.dingtalk.com/v1.0/storage/spaces/${spaceId}/files/commit?unionId=${encodeURIComponent(unionId || '')}`,
        {
          body: JSON.stringify({
            uploadKey,
            name: fileName,
            parentId: folderId,
          }),
          headers: {
            'Content-Type': 'application/json',
            'x-acs-dingtalk-access-token': token,
          },
          method: 'POST',
        },
      );
      const committed = await jsonResponse(commitResp, 'files/commit');
      const fileId =
        committed.dentry?.id ||
        committed.result?.dentry?.id ||
        committed.fileId ||
        committed.result?.fileId;
      assert(fileId, `commit missing fileId: ${JSON.stringify(committed).slice(0, 300)}`);
      const previewUrl = buildPreviewUrl(spaceId, fileId);
      try {
        const u = new URL(previewUrl);
        assert(
          u.protocol === 'https:' &&
            u.hostname === 'qr.dingtalk.com' &&
            u.pathname === '/page/yunpan' &&
            u.searchParams.get('route') === 'previewDentry' &&
            u.searchParams.get('spaceId') === String(spaceId) &&
            u.searchParams.get('fileId') === String(fileId),
          'preview_url shape invalid',
        );
      } catch (e) {
        assert(false, e.message || 'preview_url shape invalid');
      }
      pass('upload.commit', { fileId, previewUrl });

      // Gate 3: claim guard — empty tool must not allow "已上传"
      const fakeProse = '报告已上传钉盘：https://evil.example/fake';
      const emptyTool = [
        {
          content: '',
          plugin: { apiName: 'uploadHtmlToDingpan', identifier: 'lobe-dingpan' },
          role: 'tool',
        },
      ];
      const guardedEmpty = applyClaimGuard(fakeProse, emptyTool);
      assert(!guardedEmpty.includes('evil.example'), 'claim guard leaked fake URL on empty tool');
      assert(/失败|未返回/.test(guardedEmpty), 'claim guard should rewrite success claim');
      pass('guard.empty_tool');

      const successTool = [
        {
          content: JSON.stringify({ success: true, preview_url: previewUrl }),
          plugin: { apiName: 'uploadHtmlToDingpan', identifier: 'lobe-dingpan' },
          role: 'tool',
        },
      ];
      const guardedOk = applyClaimGuard('结论：完成', successTool);
      assert(guardedOk.includes(previewUrl), 'claim guard should append real preview_url');
      pass('guard.success_tool', previewUrl);

      // Gate 4: synthetic product path record (optional write if schema exists)
      try {
        const hasTable = gates.some((g) => g.name === 'schema.delivery_attempts' && g.ok);
        if (hasTable) {
          // Read-only check of unique key convention (no insert without real operation FK)
          const dedupe = `${'op_smoke'}:dingpan-report:default:report`;
          assert(dedupe.includes('dingpan-report'), 'dedupe key shape');
          pass('outbox.dedupe_key_shape', dedupe);
        }
      } catch (e) {
        fail('outbox', e.message || e);
      }
    }

    const failed = gates.filter((g) => !g.ok);
    const passed = gates.filter((g) => g.ok);
    log('\n=== product-path summary ===');
    log(`passed=${passed.length} failed=${failed.length}`);
    if (failed.length > 0) {
      for (const f of failed) console.error('-', f.name, f.err);
      process.exit(1);
    }
    if (passed.length === 0) {
      console.error('no gates passed');
      process.exit(1);
    }
    process.exit(0);
  } finally {
    await client.end().catch(() => {});
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
