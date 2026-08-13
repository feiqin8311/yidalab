import type { ChatToolPayload } from '@lobechat/types';

/** Keep Redis stream chunks small; execution still uses the full payload. */
export const STREAM_TOOL_ARG_PREVIEW_CHARS = 480;

const previewArguments = (raw: string | undefined): string => {
  if (!raw || raw.length <= STREAM_TOOL_ARG_PREVIEW_CHARS) return raw ?? '';

  try {
    const args = JSON.parse(raw) as Record<string, unknown>;
    let changed = false;
    for (const [key, value] of Object.entries(args)) {
      if (typeof value !== 'string' || value.length <= STREAM_TOOL_ARG_PREVIEW_CHARS) continue;
      args[key] =
        `${value.slice(0, STREAM_TOOL_ARG_PREVIEW_CHARS)}\n…[stream preview truncated ${value.length - STREAM_TOOL_ARG_PREVIEW_CHARS} chars]`;
      changed = true;
    }
    if (changed) return JSON.stringify(args);
  } catch {
    // not JSON — fall through
  }

  return `${raw.slice(0, STREAM_TOOL_ARG_PREVIEW_CHARS)}…[stream preview truncated]`;
};

export const previewToolsCallingForStream = (tools: ChatToolPayload[]): ChatToolPayload[] =>
  tools.map((tool) => ({
    ...tool,
    arguments: previewArguments(tool.arguments),
  }));
