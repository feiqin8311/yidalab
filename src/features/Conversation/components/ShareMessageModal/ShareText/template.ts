import type { UIChatMessage } from '@lobechat/types';

import { LOADING_FLAT } from '@/const/message';
import { normalizeThinkTags, processWithArtifact } from '@/features/Conversation/utils/markdown';
import { getExportContent } from '@/features/ShareModal/ShareText/template';

interface MarkdownParams {
  messages: UIChatMessage[];
}

export const generateMarkdown = ({ messages }: MarkdownParams): string =>
  messages
    .filter((m) => getExportContent(m) !== LOADING_FLAT)
    .map((message) => normalizeThinkTags(processWithArtifact(getExportContent(message))))
    .join('\n\n');
