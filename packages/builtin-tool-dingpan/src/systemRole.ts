export const systemPrompt = `You have a DingTalk Drive (钉盘) upload tool (\`lobe-dingpan\`).

<purpose>
Default delivery channel for user-facing **files** and for **HTML reports when the user chooses a shareable link**.
Upload and return the shareable \`preview_url\` — do not stop at a local path unless the user explicitly wants local-only output.
</purpose>

<when_to_use>
- User asks for 钉盘 / DingDrive / 预览链接 / 分享报告 as a file
- You produced a report file (xlsx/csv/pdf/md/zip/image) the user needs outside chat → \`uploadToDingpan\`
- User chose **钉盘链接** (or is on DingTalk / IM) for an HTML / interactive report → \`uploadHtmlToDingpan\`
- HTML **in-chat preview** uses \`<lobeArtifact type="text/html">\` instead — only when the user chose Artifact or is clearly on web preview
</when_to_use>

<html_delivery>
For HTML / dashboard / interactive reports:
1. If the user has not specified the delivery surface, use \`lobe-user-interaction\` → \`askUserQuestion\` with options:
   - 聊天内预览（Artifact）— in-app only, **no file**
   - 钉盘链接（可转发分享）— this tool
2. **Artifact** → emit \`<lobeArtifact type="text/html" …>\` only. Do **not** call dingpan and do **not** write a .html file.
3. **钉盘** → call \`uploadHtmlToDingpan\` with \`html\` (and optional \`documentId\` / \`topicId\` / \`title\`). That path persists per-user and returns \`preview_url\`. Reply with the link only (no raw HTML tags in IM).
4. On DingTalk or other IM channels that cannot render Artifacts, default to 钉盘 without asking when appropriate.
</html_delivery>

<folder_configuration>
Default upload folder comes from environment / LobeHub **personal** credential \`dingtalk-dingpan\` (kv-env) — each user has their own folder:
- DINGTALK_APP_KEY, DINGTALK_APP_SECRET (required)
- DINGTALK_UNION_ID or DINGTALK_USER_ID (required)
- DINGTALK_FOLDER_LINK (preferred default folder) OR DINGTALK_SPACE_ID + DINGTALK_FOLDER_ID

Per-upload override (do not hard-code company defaults in chat):
- folderLink, or spaceId + folderId on upload APIs
</folder_configuration>

<apis>
- **uploadToDingpan**: Upload filePath (absolute, on the execution host). Optional uploadName, folderLink, spaceId, folderId.
- **uploadHtmlToDingpan**: Upload HTML string and/or documentId. Persists per-user when creating; returns preview_url + document_id. No execution device required.
- **dingpanStatus**: Check whether app credentials and default folder are configured (does not print secrets).
</apis>

<rules>
- Prefer absolute paths that exist on the execution host for binary files.
- Never print APP_SECRET or full credential values.
- If folder is missing, tell the user to set personal credential \`dingtalk-dingpan\` or pass folderLink; offer Artifact as fallback on web.
- Do **not** invent OpenClaw shell helpers (e.g. upload_to_ops_dingpan.sh) — this tool is the only 钉盘 path.
- Each user's deliverables and dingpan folder are personal — never assume a shared company dump folder.
</rules>
`;
