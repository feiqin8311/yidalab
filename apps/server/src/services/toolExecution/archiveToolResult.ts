import { shapeToolResultForModel } from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import { approxTokensFromText } from '@lobechat/types';

import { TopicDocumentModel } from '@/database/models/topicDocument';
import { AgentDocumentVfsService } from '@/server/services/agentDocumentVfs';
import {
  ARCHIVE_BYPASS_IDENTIFIERS,
  DEFAULT_TOOL_RESULT_MAX_LENGTH,
  truncateToolResult,
} from '@/server/utils/truncateToolResult';

import { TOOL_RESULTS_DIR_NAME } from './constants';

const TOOL_RESULTS_DIR = `./${TOOL_RESULTS_DIR_NAME}`;

export interface ToolResultArchiveOutcome {
  archived: boolean;
  archivePath?: string;
  content: string;
  error?: string;
  /** True when structured shape / token budget altered content. */
  shaped?: boolean;
}

interface ArchiveToolResultParams {
  agentId?: string | null;
  content: string;
  identifier?: string;
  limit?: number;
  /** Token budget for model-facing content (default 8k). */
  maxToolResultTokens?: number;
  serverDB?: LobeChatDatabase;
  toolCallId?: string;
  topicId?: string | null;
  userId?: string;
  workspaceId?: string;
}

const buildArchivePath = (topicId: string, toolCallId: string) =>
  `${TOOL_RESULTS_DIR}/${topicId}_${toolCallId}.txt`;

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error || 'Unknown archive error');

export const archiveToolResultIfNeeded = async ({
  agentId,
  content,
  identifier,
  limit,
  maxToolResultTokens,
  serverDB,
  toolCallId,
  topicId,
  userId,
  workspaceId,
}: ArchiveToolResultParams): Promise<ToolResultArchiveOutcome> => {
  if (identifier && ARCHIVE_BYPASS_IDENTIFIERS.has(identifier)) {
    return { archived: false, content };
  }

  if (!content) {
    return { archived: false, content: content ?? '' };
  }

  const maxLength = limit ?? DEFAULT_TOOL_RESULT_MAX_LENGTH;
  // Always structure-shape before the char cap so 2k-row SIF dumps (adGroups)
  // stay valid JSON instead of mid-string cuts.
  const tokenBudget = maxToolResultTokens && maxToolResultTokens > 0 ? maxToolResultTokens : 8_000;

  let modelContent = content;
  let truncatedByShape = false;
  let unwrapped = false;
  let originalTokens = 0;

  if (tokenBudget != null && tokenBudget > 0) {
    const shaped = shapeToolResultForModel({
      maxTokens: tokenBudget,
      raw: content,
    });
    modelContent = shaped.content;
    truncatedByShape = shaped.truncated;
    unwrapped = shaped.unwrapped;
    originalTokens = shaped.originalTokens;
  }

  if (modelContent.length > maxLength) {
    modelContent = truncateToolResult(modelContent, maxLength);
  }

  const needsArchive =
    truncatedByShape ||
    content.length > maxLength ||
    (tokenBudget != null && approxTokensFromText(content) > tokenBudget);

  if (!needsArchive) {
    return {
      archived: false,
      content: modelContent,
      shaped: unwrapped || modelContent !== content,
    };
  }

  if (!agentId || !topicId || !toolCallId || !serverDB || !userId) {
    return { archived: false, content: modelContent, shaped: true };
  }

  const archivePath = buildArchivePath(topicId, toolCallId);

  try {
    const vfsService = new AgentDocumentVfsService(serverDB, userId, workspaceId);
    await vfsService.mkdir(TOOL_RESULTS_DIR, { agentId, topicId }, { recursive: true });
    const stats = await vfsService.write(archivePath, content, { agentId, topicId });

    if (stats.documentId) {
      const topicDocumentModel = new TopicDocumentModel(serverDB, userId, workspaceId);
      const associated = await topicDocumentModel.isAssociated(stats.documentId, topicId);
      if (!associated) {
        await topicDocumentModel.associate({
          documentId: stats.documentId,
          topicId,
        });
      }
    }

    const agentDocumentIdHint =
      stats.id ?? '(call lobe-agent-documents.listDocuments with scope=currentTopic to look up)';

    return {
      archivePath,
      archived: true,
      content: `${modelContent}\nFull content archived to the agent-document VFS.\nPath: ${archivePath}\nAgent Document ID: ${agentDocumentIdHint}\ncoverage_tokens≈${originalTokens || approxTokensFromText(content)}\nTo inspect specific sections, call the lobe-agent-documents tool with apiName=readDocument and id=<Agent Document ID above>. Do NOT activate cloud-sandbox or local-system file tools — this archive exists only inside the agent document tree.`,
      shaped: true,
    };
  } catch (error) {
    const message = getErrorMessage(error);

    return {
      archivePath,
      archived: false,
      content: `${modelContent}\n[Archive failed: ${message}. Full content was not persisted.]`,
      error: message,
      shaped: true,
    };
  }
};
