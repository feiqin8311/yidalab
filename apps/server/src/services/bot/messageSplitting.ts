const DEFAULT_CHAR_LIMIT = 1800;

export function splitMessage(text: string, limit = DEFAULT_CHAR_LIMIT): string[] {
  if (text.length <= limit) {
    // Whitespace-only input would be rejected by Telegram as "message text is empty",
    // so drop it here rather than letting downstream make a guaranteed-failing API call.
    return text.trim() ? [text] : [];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      if (remaining.trim()) chunks.push(remaining);
      break;
    }

    // Prefer semantic boundaries before falling back to a hard platform limit.
    let splitAt = remaining.lastIndexOf('\n\n', limit);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('\n', limit);
    if (splitAt <= 0) splitAt = limit;

    const chunk = remaining.slice(0, splitAt);
    if (chunk.trim()) chunks.push(chunk);
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }

  return chunks;
}
