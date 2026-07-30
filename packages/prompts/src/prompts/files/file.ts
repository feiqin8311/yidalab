import type { ChatFileItem } from '@lobechat/types';

/** Cap inline file bodies so one attachment cannot alone exhaust the context window. */
export const FILE_PROMPT_MAX_CHARS = 80_000;

const truncateFileContent = (content: string, name: string): string => {
  if (content.length <= FILE_PROMPT_MAX_CHARS) return content;
  const head = content.slice(0, FILE_PROMPT_MAX_CHARS);
  return `${head}\n\n…[truncated: inlined first ${FILE_PROMPT_MAX_CHARS} of ${content.length} chars from "${name}". Ask for specific sheets/filters or re-upload a smaller extract for full coverage.]`;
};

const filePrompt = (item: ChatFileItem, addUrl: boolean) => {
  const content = truncateFileContent(item.content || '', item.name || item.id);
  return addUrl
    ? `<file id="${item.id}" name="${item.name}" type="${item.fileType}" size="${item.size}" url="${item.url}">${content}</file>`
    : `<file id="${item.id}" name="${item.name}" type="${item.fileType}" size="${item.size}">${content}</file>`;
};

export const filePrompts = (fileList: ChatFileItem[], addUrl: boolean) => {
  if (fileList.length === 0) return '';

  const prompt = `<files>
<files_docstring>here are user upload files you can refer to</files_docstring>
${fileList.map((item) => filePrompt(item, addUrl)).join('\n')}
</files>`;

  return prompt.trim();
};
