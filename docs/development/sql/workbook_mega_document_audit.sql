-- Audit mega document bodies and spreadsheet parse state (read-only).
-- Run on staging/prod replica first.

-- 1) Mega documents (chat/RAG dumps)
SELECT
  d.id AS document_id,
  d.file_id,
  d.filename,
  d.file_type,
  length(coalesce(d.content, '')) AS content_chars,
  d.metadata->>'structured' AS structured,
  d.metadata->>'parser' AS parser,
  d.updated_at
FROM documents d
WHERE length(coalesce(d.content, '')) > 80000
ORDER BY content_chars DESC
LIMIT 200;

-- 2) Spreadsheet-like files without ready parse
SELECT
  f.id,
  f.name,
  f.file_type,
  f.size,
  f.parse_status,
  f.parse_error,
  f.parser_version,
  f.parse_task_id,
  f.parsed_at,
  f.user_id,
  f.workspace_id
FROM files f
WHERE (
    lower(f.name) LIKE '%.xlsx'
    OR lower(f.name) LIKE '%.xls'
    OR lower(f.name) LIKE '%.xlsm'
    OR f.file_type ILIKE '%spreadsheet%'
    OR f.file_type ILIKE '%excel%'
  )
  AND coalesce(f.parse_status, 'uploaded') IS DISTINCT FROM 'ready'
ORDER BY f.updated_at DESC
LIMIT 200;

-- 3) Workbook rows not ready
SELECT
  w.id,
  w.file_id,
  w.status,
  w.generation_id,
  w.sheet_count,
  w.total_rows,
  w.error,
  w.updated_at
FROM file_workbooks w
WHERE w.status IS DISTINCT FROM 'ready'
ORDER BY w.updated_at DESC
LIMIT 100;

-- 4) Parse tasks
SELECT
  t.id,
  t.status,
  t.error,
  t.created_at,
  t.updated_at,
  t.duration
FROM async_tasks t
WHERE t.type = 'file_parse'
ORDER BY t.created_at DESC
LIMIT 100;

-- 5) Count summary
SELECT
  coalesce(parse_status, 'null') AS parse_status,
  count(*) AS n
FROM files
WHERE
  lower(name) LIKE '%.xlsx'
  OR lower(name) LIKE '%.xls'
  OR lower(name) LIKE '%.xlsm'
  OR file_type ILIKE '%spreadsheet%'
  OR file_type ILIKE '%excel%'
GROUP BY 1
ORDER BY n DESC;

-- 6) Optional: reset one file for re-queue (DO NOT run blindly)
-- UPDATE files
-- SET parse_status = 'uploaded', parse_error = NULL, parse_task_id = NULL, parser_version = NULL, parsed_at = NULL
-- WHERE id = '<file_id>';
