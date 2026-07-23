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
3. **钉盘** → call \`uploadHtmlToDingpan\` with the full HTML plus structured naming fields below. Reply with the link only (no raw HTML tags in IM).
4. On DingTalk or other IM channels that cannot render Artifacts, default to 钉盘 without asking when appropriate.
</html_delivery>

<naming_and_folders>
Uploads go under the user's personal default folder (credential \`dingtalk-dingpan\`). Runtime **always creates/reuses a date subfolder** \`YYYY-MM-DD\` (Asia/Shanghai) and puts the file inside it.

HTML remote name (do **not** invent old project/agent codenames):
\`{ASIN|关键词|产品名}_{站点?}_{任务类型}_{用户名}_{YYYYMMDD}.html\`

- **用户名** = the **current human user** display name (server fills \`userName\` when possible). Never use an agent nickname.
- Example for「复盘 B0GVDTV1J6 日本站 推广节奏」by user 柯鹏翔 on 2026-07-23:
  - Path: \`…/默认文件夹/2026-07-23/B0GVDTV1J6_日本_推广复盘_柯鹏翔_20260723.html\`
  - Call with: \`asin=B0GVDTV1J6\`, \`site=日本\`, \`taskType=推广复盘\` (omit \`uploadName\` so the runtime builds the name).

When calling \`uploadHtmlToDingpan\`, pass every known field: \`asin\`, \`site\`, \`keyword\`, \`productName\`, \`taskType\`. Prefer structured fields over free-form \`uploadName\`. Only set \`uploadName\` if the user demands an exact custom name.
</naming_and_folders>

<folder_configuration>
Default upload folder comes from vault env (company app + personal folder):
- Company credential \`dingtalk\`: DINGTALK_APP_KEY, DINGTALK_APP_SECRET (shared enterprise app)
- Personal credential \`dingtalk-dingpan\`: DINGTALK_UNION_ID or DINGTALK_USER_ID, DINGTALK_FOLDER_LINK (or SPACE_ID + FOLDER_ID)

Per-upload override: folderLink, or spaceId + folderId (date subfolder still applies under that parent).
</folder_configuration>

<apis>
- **uploadToDingpan**: Upload filePath (absolute, on the execution host). Optional uploadName, folderLink, spaceId, folderId. Files land under today's date folder.
- **uploadHtmlToDingpan**: Upload HTML string and/or documentId. Pass asin/site/taskType/… for the standard name. Returns preview_url + document_id.
- **dingpanStatus**: Check whether app credentials and default folder are configured (does not print secrets).
</apis>

<rules>
- Prefer absolute paths that exist on the execution host for binary files.
- Never print APP_SECRET or full credential values.
- If folder is missing, tell the user to set personal credential \`dingtalk-dingpan\` or pass folderLink; offer Artifact as fallback on web.
- Each user's deliverables and dingpan folder are personal — never assume a shared dump directory.
</rules>
`;
