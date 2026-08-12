import { approxTokensFromText } from '@lobechat/types';

import { DEFAULT_SUBAGENT_RETURN_TOKENS } from '../types/contextPolicy';

/**
 * Cap sub-agent → parent return content to a structured summary budget.
 * Full trajectory stays isolated on the child thread.
 */
export const capSubAgentReturnContent = (
  content: string | undefined | null,
  maxTokens: number = DEFAULT_SUBAGENT_RETURN_TOKENS,
): string => {
  const text = content ?? '';
  if (!text) return text;
  if (approxTokensFromText(text) <= maxTokens) return text;

  const maxChars = Math.max(256, Math.floor(maxTokens * 4));
  const head = Math.floor(maxChars * 0.7);
  const tail = Math.floor(maxChars * 0.25);
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n…[sub-agent return truncated ~${omitted} chars; full trajectory remains on child thread]…\n${text.slice(-tail)}`;
};
