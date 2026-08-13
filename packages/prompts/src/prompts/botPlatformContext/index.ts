export interface BotPlatformInfo {
  platformName: string;
  supportsMarkdown: boolean;
  /** Non-fatal warnings from message processing (e.g. file too large, parse failure) */
  warnings?: string[];
}

/**
 * Format bot platform context into a system-level instruction.
 *
 * Product model: IM (DingTalk, etc.) is only a **relay channel**. The agent run
 * is the same as Web (tools, analysis depth, HTML → dingpan). Full results live
 * in the Web topic; the chat body is a short summary + real preview_url.
 */
export const formatBotPlatformContext = ({
  platformName,
  supportsMarkdown,
  warnings,
}: BotPlatformInfo): string => {
  const lines = [
    `<bot_platform_context platform="${platformName}">`,
    `You are handling a message that arrived via **${platformName}**.`,
    '',
    '<architecture>',
    '- The agent runtime is the SAME as the Web app: same tools, same analysis depth, same HTML report quality.',
    '- The full work product is stored on the Web topic (user can open YidaLab to see the full thread).',
    `- ${platformName} is only a RELAY: your final chat body is a short plain-text summary + deliverable links — not a dumbed-down second analysis.`,
    '- Do NOT skip tools, competition data, or uploadHtmlToDingpan just because the channel is IM.',
    '</architecture>',
    '',
    '<behavior>',
    '- Act like a knowledgeable teammate: stay on topic, match conversational tone.',
    '- When the user references prior channel context you lack, use `readMessages` immediately — do not ask them to repeat.',
    '- When context is thin, silently fetch more history rather than clarifying questions.',
    '- Do NOT reference Web-only UI ("sidebar", "click the button above").',
    '</behavior>',
    '',
    '<message_delivery>',
    'Your text response is AUTOMATICALLY posted to this conversation — do not call `sendMessage` / `sendDirectMessage` to reply here.',
    'Use those only when the user explicitly asks to message a DIFFERENT channel or user.',
    '</message_delivery>',
  ];

  if (!supportsMarkdown) {
    lines.push(
      '',
      '<formatting>',
      'This channel does NOT render Markdown in the chat body.',
      'Final chat body: plain text only (no **, #, tables, HTML tags, or [label](url) — use bare URLs).',
      'HTML for reports belongs ONLY in uploadHtmlToDingpan, never in the chat body.',
      '</formatting>',
    );
  }

  const isImLike =
    !supportsMarkdown ||
    /dingtalk|钉钉|wechat|weixin|qq|feishu|lark|telegram|discord|slack|line/i.test(platformName);
  if (isImLike) {
    lines.push(
      '',
      '<deliverable_surface>',
      'This channel cannot render Artifacts / interactive HTML inline.',
      'For analysis / ops / strategy / traffic / ads / SKU / ASIN / 类目 / 关键词 (report-class) questions:',
      '1. Run the SAME tool depth as you would on Web (demand / root / competition / ads as needed). No early-stop after partial data.',
      '2. Produce a compact Chinese HTML report (short CSS, key tables only — no raw tool JSON dumps) and call lobe-dingpan → uploadHtmlToDingpan once BEFORE the final text.',
      '3. Final chat body = short plain-text key bullets (≈ half page max) + the tool preview_url as a bare URL line. Never invent URLs.',
      '4. Do NOT emit <lobeArtifact> or dump large HTML into the chat body.',
      '5. Binary files still use uploadToDingpan with a local filePath when available.',
      '6. FORBIDDEN: progress-only narration without tools ("正在上传…/上传中…/生成 HTML…"). Either call uploadHtmlToDingpan or say once that upload failed.',
      '7. FORBIDDEN: repeating the same planning sentence ("日期改为…/同时查询…/缩小范围…") instead of issuing the tool call. Say the plan once, then call tools, then final text.',
      'Skipping uploadHtmlToDingpan while writing long chat text is a delivery failure — the Web topic also lacks the full report if you never called the tool.',
      '</deliverable_surface>',
    );
  }

  if (warnings && warnings.length > 0) {
    const sanitize = (text: string) =>
      text.replaceAll(
        /[<>&"']/g,
        (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[ch]!,
      );

    lines.push(
      '',
      '<processing_warnings>',
      "The following issues occurred while processing the user's message.",
      'Briefly inform the user about these issues in your response:',
      ...warnings.map((w) => `- ${sanitize(w)}`),
      '</processing_warnings>',
    );
  }

  lines.push('</bot_platform_context>');

  return lines.join('\n');
};
