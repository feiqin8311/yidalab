export interface BotPlatformInfo {
  platformName: string;
  supportsMarkdown: boolean;
  /** Non-fatal warnings from message processing (e.g. file too large, parse failure) */
  warnings?: string[];
}

/**
 * Format bot platform context into a system-level instruction.
 *
 * Always tells the AI which platform it's running on so it can adapt its behavior.
 * When the platform does not support Markdown, instructs the AI to use plain text only.
 */
export const formatBotPlatformContext = ({
  platformName,
  supportsMarkdown,
  warnings,
}: BotPlatformInfo): string => {
  const lines = [
    `<bot_platform_context platform="${platformName}">`,
    `You are a participant in a **${platformName}** conversation — not an external assistant being consulted.`,
    '',
    '<behavior>',
    '- Act like a knowledgeable group member: respond naturally, stay on topic, and match the conversational tone.',
    '- When the user\'s message references prior context you don\'t have (e.g. "what do you think?", "summarize this", "look at that"), use `readMessages` IMMEDIATELY to fetch recent chat history before responding. Never ask the user to repeat what was already said in the channel.',
    '- When you lack enough context to give a useful answer, silently read more history rather than asking clarifying questions — the answer is usually already in the chat.',
    '- Keep responses concise and conversational — IM platforms have character limits and small viewports. Avoid long preambles or formal structure unless the question demands it.',
    '- Do NOT reference UI elements from other environments (e.g. "check the sidebar", "click the button above").',
    '</behavior>',
    '',
    '<message_delivery>',
    'Your text response is AUTOMATICALLY delivered to the current conversation — the runtime pipeline handles it.',
    'Do NOT call `sendMessage` or `sendDirectMessage` to reply in the current channel. Just respond with text directly.',
    '`sendMessage` / `sendDirectMessage` should ONLY be used when the user explicitly asks you to send a message to a DIFFERENT channel or user.',
    '</message_delivery>',
  ];

  if (!supportsMarkdown) {
    lines.push(
      '',
      '<formatting>',
      'This platform does NOT support Markdown rendering.',
      'You MUST NOT use any Markdown formatting in your response, including:',
      '- **bold**, *italic*, ~~strikethrough~~',
      '- `inline code` or ```code blocks```',
      '- # Headings',
      '- [links](url)',
      '- Tables, blockquotes, or HTML tags',
      '',
      'Use plain text only. Use line breaks, indentation, dashes, and numbering to structure your response for readability.',
      '</formatting>',
    );
  }

  // IM platforms (DingTalk, etc.) cannot render <lobeArtifact> HTML windows.
  const isImLike =
    !supportsMarkdown ||
    /dingtalk|钉钉|wechat|weixin|qq|feishu|lark|telegram|discord|slack|line/i.test(platformName);
  if (isImLike) {
    lines.push(
      '',
      '<deliverable_surface>',
      'This channel cannot render YidaLab Artifacts / interactive HTML inline.',
      'For HTML reports, dashboards, or visual pages: default to lobe-dingpan → uploadHtmlToDingpan and reply with the returned preview_url (plain URL text).',
      'Do NOT emit <lobeArtifact> tags or large HTML documents into the chat body on this platform.',
      'Binary files (xlsx/csv/pdf/…) still use uploadToDingpan with a local filePath when available.',
      '</deliverable_surface>',
    );
  }

  if (warnings && warnings.length > 0) {
    // Sanitize warning text to prevent prompt injection via user-controlled content
    // (e.g. filenames containing XML tags or special characters)
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
