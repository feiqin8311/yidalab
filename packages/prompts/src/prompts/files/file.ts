import type { ChatFileItem } from '@lobechat/types';

/** Cap inline file bodies so one attachment cannot alone exhaust the context window. */
export const FILE_PROMPT_MAX_CHARS = 80_000;

/** Per-file card budget when content is a structured manifest (not full dump). */
export const FILE_CARD_PROMPT_MAX_CHARS = 12_000;

/** Combined budget for all file cards in one user turn. */
export const ALL_FILE_CARDS_PROMPT_MAX_CHARS = 48_000;

const truncateFileContent = (content: string, name: string, maxChars: number): string => {
  if (content.length <= maxChars) return content;
  const head = content.slice(0, maxChars);
  return `${head}\n\n…[truncated: inlined first ${maxChars} of ${content.length} chars from "${name}". Use tools for full coverage.]`;
};

const filePrompt = (item: ChatFileItem, addUrl: boolean, maxChars: number) => {
  const content = truncateFileContent(item.content || '', item.name || item.id, maxChars);
  const statusAttr = item.parseStatus ? ` parseStatus="${item.parseStatus}"` : '';
  return addUrl
    ? `<file id="${item.id}" name="${item.name}" type="${item.fileType}" size="${item.size}" url="${item.url}"${statusAttr}>${content}</file>`
    : `<file id="${item.id}" name="${item.name}" type="${item.fileType}" size="${item.size}"${statusAttr}>${content}</file>`;
};

export const filePrompts = (fileList: ChatFileItem[], addUrl: boolean) => {
  if (fileList.length === 0) return '';

  // Dynamic per-file budget from remaining total card budget.
  let remaining = ALL_FILE_CARDS_PROMPT_MAX_CHARS;
  const parts: string[] = [];
  for (const item of fileList) {
    if (remaining <= 0) {
      parts.push(
        `<file id="${item.id}" name="${item.name}" type="${item.fileType}" size="${item.size}">…omitted: attachment card budget exhausted. Use lobe-workbook tools with this fileId.</file>`,
      );
      continue;
    }
    const maxChars = Math.min(FILE_CARD_PROMPT_MAX_CHARS, remaining, FILE_PROMPT_MAX_CHARS);
    const block = filePrompt(item, addUrl, maxChars);
    parts.push(block);
    remaining -= block.length;
  }

  const prompt = `<files>
<files_docstring>User-uploaded files. Large spreadsheets only include a bounded manifest — call lobe-workbook inspectWorkbook/querySheet for full data. Never assume the full grid is inlined.</files_docstring>
${parts.join('\n')}
</files>`;

  return prompt.trim();
};
