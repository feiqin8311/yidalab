import type { UIChatMessage } from '@lobechat/types';

import { LOADING_FLAT } from '@/const/message';
import { normalizeThinkTags, processWithArtifact } from '@/features/Conversation/utils/markdown';
import type { FieldType } from '@/features/ShareModal/ShareText/type';

interface MarkdownParams extends FieldType {
  messages: UIChatMessage[];
  systemRole: string;
  title: string;
}

const GROUP_ROLES = new Set(['assistantGroup', 'supervisor']);

export const getExportContent = (message: UIChatMessage): string => {
  if (GROUP_ROLES.has(message.role) && message.children?.length) {
    return message.children
      .map((child) => child.content)
      .filter(Boolean)
      .join('\n\n');
  }

  return message.content ?? '';
};

const getExportTools = (message: UIChatMessage) =>
  message.tools?.length
    ? message.tools
    : (message.children ?? []).flatMap((child) => child.tools ?? []);

export const generateMarkdown = ({
  messages,
  title,
  includeTool,
  includeUser,
  withSystemRole,
  withRole,
  systemRole,
}: MarkdownParams): string => {
  const parts: string[] = [`# ${title}`, ''];

  if (withSystemRole && systemRole) {
    parts.push('````md', systemRole, '````', '');
  }

  const filteredMessages = messages
    .filter((m) => getExportContent(m) !== LOADING_FLAT)
    .filter((m) => (!includeUser ? m.role !== 'user' : true))
    .filter((m) => (!includeTool ? m.role !== 'tool' : true))
    .map((message) => ({
      ...message,
      content: normalizeThinkTags(processWithArtifact(getExportContent(message))),
      tools: getExportTools(message),
    }));

  for (const chat of filteredMessages) {
    parts.push('');

    if (withRole) {
      if (chat.role === 'user') {
        parts.push('##### User:', '');
      } else if (chat.role === 'assistant' || GROUP_ROLES.has(chat.role)) {
        parts.push('##### Assistant:', '');
      } else if (chat.role === 'tool') {
        parts.push('##### Tools Calling:', '');
      }
    }

    if (chat.role === 'tool') {
      parts.push('```json', String(chat.content), '```');
    } else {
      parts.push(String(chat.content));

      if (includeTool && chat.tools && chat.tools.length > 0) {
        parts.push('', '```json', JSON.stringify(chat.tools, null, 2), '```');
      }
    }
  }

  return parts.join('\n');
};
