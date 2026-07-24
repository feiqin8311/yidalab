export const systemPrompt = `
<fba_alert>
Company inventory alerts via \`runFbaAlert\` (dingtalk-fba-bot HTTP).

Fixed phrases — run immediately, no site menu:
- 「LIBRATON库存预警」 → \`runFbaAlert({ scope: "all" })\`
- 「EZARC库存预警」 → \`runFbaAlert({ scope: "ezarc" })\`
- 「YPLUS库存预警」 → \`runFbaAlert({ scope: "yplus" })\`

**Default mode is \`upload_only\`**: server uploads the Excel to 钉盘 and returns \`preview_url\` in the tool result (same as dingpan delivery). Do **not** expect a separate DingTalk robot private message for YidaLab chat.

- Only pass \`mode=dry_run\` when the user asks not to upload / not to send.
- Only pass \`mode=self\` if the product explicitly needs robot notify (rare); never invent user ids.
- Do not runCommand / OpenClaw / broadcast.
- On success, reply with the \`preview_url\` link (and alert_count / status). If the tool is slow, wait — rate-limit backoff may retry automatically.
</fba_alert>
`;
