/**
 * Unified bot outbound reply preparation.
 *
 * Product model (YidaLab):
 * - The agent run is shared with Web: tools, analysis depth, reports, and topic history.
 * - DingTalk is a primary conversation surface and receives the complete Markdown reply.
 * - Channels with tighter message constraints may opt into compact relay mode.
 * - Files and HTML reports remain external deliverables and are attached as trusted links.
 *
 * Isolation rule: only this operation's dingpan uploads may be attached.
 * Never fall back to topic history (cross-turn report contamination).
 */

import { type DeliveryClaimMessage, extractDingpanUploadOutcomes } from '@lobechat/agent-runtime';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';

import {
  scrubFakeUploadProgressNarration,
  shouldEnsureDingpanForBotReply,
} from './botDingpanDeliveryHeuristic';
import type { BotTurnContext } from './botTurnContext';
import { ensureDingpanDeliverable } from './ensureDingpanDeliverable';

const MISSING_REPORT_NOTE =
  '说明：本轮钉盘报告上传失败；上述分析结果已在当前会话完整返回。如仍需报告文件，请重新提出生成报告请求。';

const MAX_RELAY_CHARS = 1200;

export type BotRelayMode = 'compact' | 'full';

const DINGPAN_URL_RE =
  /https:\/\/qr\.dingtalk\.com\/page\/yunpan[^\s)\]>"']+|https:\/\/[^\s)\]>"']*previewDentry[^\s)\]>"']*/gi;

const hasDingpanUrl = (text: string) =>
  /qr\.dingtalk\.com|previewDentry|yunpan\?route=preview/i.test(text);

const extractFirstDingpanUrl = (text: string): string | undefined => {
  const m = text.match(
    /https:\/\/qr\.dingtalk\.com\/page\/yunpan[^\s)\]>"']+|https:\/\/[^\s)\]>"']*previewDentry[^\s)\]>"']*/,
  );
  return m?.[0];
};

/** Strip dingpan URLs that are not in the allowlist (this-operation only). */
const scrubUntrustedDingpanUrls = (text: string, allowed?: string): string => {
  if (!hasDingpanUrl(text)) return text;
  return text
    .replaceAll(DINGPAN_URL_RE, (url) => (allowed && url === allowed ? url : ''))
    .replaceAll(/\n{3,}/g, '\n\n')
    .replaceAll(/钉盘报告：\s*$/gm, '')
    .trim();
};

/**
 * Keep a short plain-text relay for channels that cannot carry the full answer.
 */
export const compactBotRelayText = (reply: string, maxChars = MAX_RELAY_CHARS): string => {
  let text = reply.trim();
  if (!text) return text;

  // Drop markdown link wrappers → bare URL (IM has no MD)
  text = text.replaceAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '$2');
  // CommonMark autolink <https://...> — DingTalk shows the brackets as literal junk
  text = text.replaceAll(/<(https?:\/\/[^>\s]+)>/g, '$1');

  if (text.length <= maxChars) return text;

  // Prefer content before the first dingpan URL (conclusions first)
  const url = extractFirstDingpanUrl(text);
  if (url) {
    const idx = text.indexOf(url);
    const before = text.slice(0, idx).trim();
    const after = text.slice(idx + url.length).trim();
    const head = before.length > 40 ? before : text.slice(0, maxChars - url.length - 20);
    const clipped =
      head.length > maxChars - url.length - 30
        ? `${head.slice(0, maxChars - url.length - 40).trim()}…`
        : head;
    const tailNote = after && !after.includes(url) ? '' : '';
    return `${clipped}\n\n钉盘报告：\n${url}${tailNote}`.trim();
  }

  return `${text.slice(0, maxChars - 1).trim()}…`;
};

const latestOperationPreview = async (params: {
  db: LobeChatDatabase;
  operationId: string;
  topicId?: string | null;
  userId: string;
  workspaceId?: string | null;
}): Promise<string | undefined> => {
  const messageModel = new MessageModel(params.db, params.userId, params.workspaceId ?? undefined);
  const rows = await messageModel.findDingpanUploadsByOperation({
    operationId: params.operationId,
    topicId: params.topicId,
  });
  const outcomes = extractDingpanUploadOutcomes(
    rows.map((row): DeliveryClaimMessage => ({
      content: row.content ?? '',
      plugin: {
        apiName: row.apiName ?? undefined,
        identifier: row.identifier ?? undefined,
      },
      role: 'tool',
    })),
  );
  return [...outcomes].reverse().find((o) => o.success && o.previewUrl)?.previewUrl;
};

/** Best-effort: mark operation outcome verified when tool path already delivered. */
const markOutcomeVerifiedIfNeeded = async (params: {
  db: LobeChatDatabase;
  operationId: string;
  previewUrl: string;
  userId: string;
  workspaceId?: string | null;
}) => {
  try {
    const opModel = new AgentOperationModel(
      params.db,
      params.userId,
      params.workspaceId ?? undefined,
    );
    await opModel.recordOutcome(params.operationId, {
      outcomeErrorCode: null,
      outcomePreviewUrl: params.previewUrl,
      outcomeRetryable: false,
      outcomeStatus: 'verified',
      outcomeType: 'dingpan',
      outcomeVerifiedAt: new Date(),
    });
  } catch (error) {
    console.error('[prepareBotOutboundReply] recordOutcome non-fatal:', error);
  }
};

/**
 * Single exit for bot-channel text after agent completion.
 */
export async function prepareBotOutboundReply(params: {
  assistantMessageId?: string;
  db: LobeChatDatabase;
  operationId?: string | null;
  relayMode?: BotRelayMode;
  reply: string;
  sourceMessageId?: string;
  topicId?: string | null;
  userId: string;
  workspaceId?: string | null;
}): Promise<string> {
  const { db, userId, workspaceId, topicId, operationId, assistantMessageId, sourceMessageId } =
    params;
  let reply = scrubFakeUploadProgressNarration(params.reply);
  if (!reply.trim()) return reply;
  const prepareRelayText = (text: string) =>
    params.relayMode === 'full' ? text.trim() : compactBotRelayText(text);

  try {
    // 1. This operation already uploaded successfully → attach that link only.
    //    Any other dingpan URL in prose (historical / model re-paste) is stripped.
    if (operationId) {
      const previewUrl = await latestOperationPreview({
        db,
        operationId,
        topicId,
        userId,
        workspaceId,
      });
      if (previewUrl) {
        reply = scrubUntrustedDingpanUrls(reply, previewUrl);
        if (!reply.includes(previewUrl)) {
          reply = `${reply.trim()}\n\n钉盘报告：\n${previewUrl}`;
        }
        await markOutcomeVerifiedIfNeeded({
          db,
          operationId,
          previewUrl,
          userId,
          workspaceId,
        });
        return prepareRelayText(reply);
      }
    }

    // 2. No this-operation upload: never trust prose dingpan URLs (history contamination).
    reply = scrubUntrustedDingpanUrls(reply);

    // 3. Report-class without this-turn upload: system fallback for THIS operation only.
    if (shouldEnsureDingpanForBotReply(reply) && topicId && operationId) {
      const turn: BotTurnContext = {
        assistantMessageId,
        operationId,
        sourceMessageId,
        startedAt: new Date(),
        topicId,
      };
      const ensured = await ensureDingpanDeliverable({
        db,
        reply,
        turn,
        userId,
        workspaceId,
      });
      if (ensured.previewUrl) {
        reply = `${reply.trim()}\n\n钉盘报告：\n${ensured.previewUrl}`;
        return prepareRelayText(reply);
      }
      if (
        reply.includes('未调用') ||
        reply.includes('uploadHtmlToDingpan') ||
        reply.includes(MISSING_REPORT_NOTE)
      ) {
        return prepareRelayText(reply);
      }
      const failNote = ensured.error
        ? `${MISSING_REPORT_NOTE}\n原因：${ensured.error.slice(0, 160)}`
        : MISSING_REPORT_NOTE;
      return prepareRelayText(`${reply.trim()}\n\n${failNote}`);
    }

    // 4. Non-report / missing operationId: send as-is without any dingpan links.
    return prepareRelayText(reply);
  } catch (error) {
    console.error('[prepareBotOutboundReply] non-fatal:', error);
    return prepareRelayText(scrubUntrustedDingpanUrls(reply));
  }
}
