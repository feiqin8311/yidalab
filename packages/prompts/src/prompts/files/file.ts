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
  return `${head}\n\n…[truncated: inlined first ${maxChars} of ${content.length} chars from "${name}". Upload via Resources for full indexing; do not use cloud sandbox.]`;
};

const filePrompt = (item: ChatFileItem, addUrl: boolean, maxChars: number) => {
  const raw = item.content?.trim() ? item.content : '';
  // Empty body: never hand a download URL (docx/xlsx URLs are binary — models crawl them).
  const content = raw
    ? truncateFileContent(raw, item.name || item.id, maxChars)
    : `No extractable text for this attachment (id=${item.id}, name="${item.name}", type=${item.fileType}). Do not fetch the file URL (binary). Ask the user to paste text or re-upload as .txt/.md, or upload via Resources for indexing.`;
  const statusAttr = item.parseStatus ? ` parseStatus="${item.parseStatus}"` : '';
  const includeUrl = addUrl && Boolean(raw);
  return includeUrl
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
        `<file id="${item.id}" name="${item.name}" type="${item.fileType}" size="${item.size}">…omitted: attachment card budget exhausted. Upload via Resources for full indexing (spreadsheet resources: lobe-workbook). Do not use cloud sandbox.</file>`,
      );
      continue;
    }
    const maxChars = Math.min(FILE_CARD_PROMPT_MAX_CHARS, remaining, FILE_PROMPT_MAX_CHARS);
    const block = filePrompt(item, addUrl, maxChars);
    parts.push(block);
    remaining -= block.length;
  }

  const prompt = `<files>
<files_docstring>User-uploaded files. Chat attachments are preview-only. Persistent spreadsheet resources: lobe-workbook inspectWorkbook/querySheet for full data. Cloud sandbox is not available — never call lobe-cloud-sandbox for file content. Never assume the full grid is inlined.</files_docstring>
${parts.join('\n')}
</files>`;

  return prompt.trim();
};
