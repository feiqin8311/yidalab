/** Pull `reset at 2026-08-13 13:41:39` from a Volcengine-style quota message. */
export const parseQuotaResetAt = (message?: string): string | undefined => {
  if (!message) return undefined;
  const match = /reset at\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})(?::\d{2})?/i.exec(message);
  return match?.[1];
};
