-- Chat attachments (processing_policy=on_demand) must not live on agents_files.
-- They were auto-mounted by conversationLifecycle after sendMessage; remove historical rows.
DELETE FROM "agents_files" af
USING "files" f
WHERE af.file_id = f.id
  AND f.processing_policy = 'on_demand';
