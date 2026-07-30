/**
 * Mega-document / spreadsheet cleanup for YidaLab workbook rollout.
 *
 * SAFETY:
 * - Always scopes by WORKBOOK_ENQUEUE_USER_ID (and optional WORKSPACE_ID).
 * - Default is dry-run; --apply mutates.
 * - --apply creates backup rows in documents_mega_cleanup_backup before UPDATE.
 * - Spreadsheet docs: only replace when file is ready AND S3/original file exists.
 * - Non-spreadsheet: only cap when scoped to this user/workspace.
 *
 * Usage:
 *   WORKBOOK_ENQUEUE_USER_ID=<user> bun scripts/workbook-mega-cleanup.ts [--apply] [--wait-ms=120000] [--threshold=80000]
 */
import { sql } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import { WorkbookService } from '@/server/services/workbook';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const waitMs = Number(args.find((a) => a.startsWith('--wait-ms='))?.split('=')[1] || 0);
const threshold = Number(args.find((a) => a.startsWith('--threshold='))?.split('=')[1] || 80_000);

const userId = process.env.WORKBOOK_ENQUEUE_USER_ID;
if (!userId) {
  console.error('Set WORKBOOK_ENQUEUE_USER_ID (required tenant scope).');
  process.exit(1);
}
const workspaceId = process.env.WORKBOOK_ENQUEUE_WORKSPACE_ID || undefined;

const isSpreadsheetName = (name: string | null, fileType: string | null) => {
  const n = (name || '').toLowerCase();
  const t = (fileType || '').toLowerCase();
  return (
    n.endsWith('.xlsx') ||
    n.endsWith('.xls') ||
    n.endsWith('.xlsm') ||
    t.includes('spreadsheet') ||
    t.includes('excel')
  );
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Normalize drizzle execute result to rows array. */
const asRows = (result: unknown): Record<string, unknown>[] => {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
};

const main = async () => {
  const db = await getServerDB();
  const service = new WorkbookService(db, userId, workspaceId);

  // Ensure backup table exists (idempotent).
  if (apply) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS documents_mega_cleanup_backup (
        id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
        document_id text NOT NULL,
        user_id text NOT NULL,
        workspace_id text,
        content text,
        metadata jsonb,
        total_char_count integer,
        backed_up_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  const scopeDocs =
    workspaceId === undefined
      ? sql`d.user_id = ${userId} AND d.workspace_id IS NULL`
      : sql`d.user_id = ${userId} AND d.workspace_id = ${workspaceId}`;

  const scopeFiles =
    workspaceId === undefined
      ? sql`f.user_id = ${userId} AND f.workspace_id IS NULL`
      : sql`f.user_id = ${userId} AND f.workspace_id = ${workspaceId}`;

  const mega = await db.execute(sql`
    SELECT
      d.id AS document_id,
      d.file_id,
      d.filename,
      d.file_type,
      d.user_id,
      d.workspace_id,
      length(coalesce(d.content, '')) AS content_chars,
      d.metadata,
      f.parse_status,
      f.name AS file_name,
      f.file_type AS file_mime,
      f.url AS file_url
    FROM documents d
    LEFT JOIN files f ON f.id = d.file_id
    WHERE length(coalesce(d.content, '')) > ${threshold}
      AND ${scopeDocs}
    ORDER BY content_chars DESC
    LIMIT 500
  `);

  const rows = asRows(mega);
  console.log(
    JSON.stringify(
      {
        phase: 'discover',
        count: rows.length,
        threshold,
        apply,
        userId,
        workspaceId: workspaceId ?? null,
      },
      null,
      2,
    ),
  );

  const spreadsheetFileIds = new Set<string>();
  const nonSpreadsheetDocs: {
    documentId: string;
    chars: number;
    fileId: string | null;
    fileUrl: string | null;
  }[] = [];

  for (const row of rows) {
    const fileId = (row.file_id as string | null) ?? null;
    const name = String(row.file_name || row.filename || '');
    const mime = String(row.file_mime || row.file_type || '');
    const structured = Boolean((row.metadata as { structured?: boolean } | null)?.structured);
    if (structured) continue;

    if (fileId && isSpreadsheetName(name, mime)) {
      spreadsheetFileIds.add(fileId);
    } else {
      nonSpreadsheetDocs.push({
        chars: Number(row.content_chars),
        documentId: String(row.document_id),
        fileId,
        fileUrl: (row.file_url as string | null) ?? null,
      });
    }
  }

  const pendingFiles = await db.execute(sql`
    SELECT f.id, f.name, f.file_type, f.parse_status, f.url
    FROM files f
    WHERE (
      lower(f.name) LIKE '%.xlsx' OR lower(f.name) LIKE '%.xls' OR lower(f.name) LIKE '%.xlsm'
      OR f.file_type ILIKE '%spreadsheet%' OR f.file_type ILIKE '%excel%'
    )
    AND coalesce(f.parse_status, 'uploaded') IS DISTINCT FROM 'ready'
    AND ${scopeFiles}
    LIMIT 500
  `);
  for (const r of asRows(pendingFiles)) spreadsheetFileIds.add(String(r.id));

  console.log(
    JSON.stringify({
      phase: 'plan',
      spreadsheetFiles: [...spreadsheetFileIds],
      nonSpreadsheetMegaDocs: nonSpreadsheetDocs.length,
    }),
  );

  if (!apply) {
    console.log('Dry-run only. Re-run with --apply to backup/enqueue/replace/cap.');
    return;
  }

  for (const fileId of spreadsheetFileIds) {
    try {
      const taskId = await service.asyncEnqueueParse(fileId, true);
      console.log(JSON.stringify({ action: 'enqueue', fileId, taskId, ok: true }));
    } catch (e) {
      console.error(JSON.stringify({ action: 'enqueue', fileId, ok: false, error: String(e) }));
    }
  }

  if (waitMs > 0) {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      let ready = 0;
      for (const fileId of spreadsheetFileIds) {
        const wb = await service.getReadyWorkbook(fileId);
        if (wb?.status === 'ready') ready++;
      }
      console.log(
        JSON.stringify({
          phase: 'wait',
          ready,
          total: spreadsheetFileIds.size,
          remainingMs: deadline - Date.now(),
        }),
      );
      if (ready >= spreadsheetFileIds.size) break;
      await sleep(5_000);
    }
  }

  for (const fileId of spreadsheetFileIds) {
    try {
      const inspect = await service.inspectWorkbook(fileId);
      if (inspect.parseStatus !== 'ready' || !inspect.promptCard) {
        console.log(
          JSON.stringify({ action: 'replace-skip', fileId, status: inspect.parseStatus }),
        );
        continue;
      }
      const card = inspect.promptCard;

      // Backup then replace — scoped to this user/workspace only.
      await db.execute(sql`
        INSERT INTO documents_mega_cleanup_backup (document_id, user_id, workspace_id, content, metadata, total_char_count)
        SELECT d.id, d.user_id, d.workspace_id, d.content, d.metadata, d.total_char_count
        FROM documents d
        WHERE d.file_id = ${fileId}
          AND ${scopeDocs}
          AND length(coalesce(d.content, '')) > ${threshold}
          AND coalesce(d.metadata->>'structured', 'false') IS DISTINCT FROM 'true'
      `);

      await db.execute(sql`
        UPDATE documents d
        SET
          content = ${card},
          total_char_count = ${card.length},
          total_line_count = ${card.split('\n').length},
          metadata = coalesce(d.metadata, '{}'::jsonb) || ${JSON.stringify({
            parser: 'workbook-v1',
            structured: true,
            megaCleanupAt: new Date().toISOString(),
          })}::jsonb,
          updated_at = now()
        WHERE d.file_id = ${fileId}
          AND ${scopeDocs}
          AND length(coalesce(d.content, '')) > ${threshold}
      `);
      console.log(JSON.stringify({ action: 'replace-card', fileId, ok: true }));
    } catch (e) {
      console.error(
        JSON.stringify({ action: 'replace-card', fileId, ok: false, error: String(e) }),
      );
    }
  }

  for (const doc of nonSpreadsheetDocs) {
    try {
      // Skip if no associated file and we cannot prove ownership via scope already applied.
      const keep = Math.min(12_000, threshold);

      await db.execute(sql`
        INSERT INTO documents_mega_cleanup_backup (document_id, user_id, workspace_id, content, metadata, total_char_count)
        SELECT d.id, d.user_id, d.workspace_id, d.content, d.metadata, d.total_char_count
        FROM documents d
        WHERE d.id = ${doc.documentId}
          AND ${scopeDocs}
          AND length(coalesce(d.content, '')) > ${threshold}
          AND coalesce(d.metadata->>'structured', 'false') IS DISTINCT FROM 'true'
      `);

      await db.execute(sql`
        UPDATE documents d
        SET
          content = left(coalesce(d.content, ''), ${keep}) || E'\n…[mega content capped by workbook-mega-cleanup; open original file for full body]',
          total_char_count = length(left(coalesce(d.content, ''), ${keep})) + 80,
          metadata = coalesce(d.metadata, '{}'::jsonb) || ${JSON.stringify({
            megaCapped: true,
            megaCleanupAt: new Date().toISOString(),
            originalChars: doc.chars,
          })}::jsonb,
          updated_at = now()
        WHERE d.id = ${doc.documentId}
          AND ${scopeDocs}
          AND length(coalesce(d.content, '')) > ${threshold}
          AND coalesce(d.metadata->>'structured', 'false') IS DISTINCT FROM 'true'
      `);
      console.log(JSON.stringify({ action: 'cap-mega', documentId: doc.documentId, ok: true }));
    } catch (e) {
      console.error(
        JSON.stringify({
          action: 'cap-mega',
          documentId: doc.documentId,
          ok: false,
          error: String(e),
        }),
      );
    }
  }

  console.log(
    JSON.stringify({
      phase: 'done',
      restoreHint: 'Restore from documents_mega_cleanup_backup joining document_id if needed.',
    }),
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
