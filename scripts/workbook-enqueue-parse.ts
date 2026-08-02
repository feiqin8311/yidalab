/**
 * Ops helper: enqueue async workbook parse for file ids (server-side).
 *
 * Usage (from repo root, with DB + APP_URL env loaded as for server):
 *   bun scripts/workbook-enqueue-parse.ts <fileId> [fileId...]
 *
 * Requires: same env as apps/server (DATABASE_URL, APP_URL for async self-call).
 */
import { getServerDB } from '@/database/core/db-adaptor';
import { WorkbookService } from '@/server/services/workbook';

const fileIds = process.argv.slice(2).filter(Boolean);
if (fileIds.length === 0) {
  console.error('Usage: bun scripts/workbook-enqueue-parse.ts <fileId> [fileId...]');
  process.exit(1);
}

const userId = process.env.WORKBOOK_ENQUEUE_USER_ID;
if (!userId) {
  console.error('Set WORKBOOK_ENQUEUE_USER_ID to a user who can access the files.');
  process.exit(1);
}

const workspaceId = process.env.WORKBOOK_ENQUEUE_WORKSPACE_ID || undefined;

const main = async () => {
  const db = await getServerDB();
  const service = new WorkbookService(db, userId, workspaceId);
  for (const fileId of fileIds) {
    try {
      const taskId = await service.asyncEnqueueParse(fileId, false);
      console.log(JSON.stringify({ fileId, taskId, ok: true }));
    } catch (e) {
      console.error(JSON.stringify({ fileId, ok: false, error: String(e) }));
    }
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
