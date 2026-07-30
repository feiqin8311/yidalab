/**
 * Unified bot outbound reply preparation.
 *
 * Product model (YidaLab):
 * - The agent run is the same as Web: tools, analysis depth, HTML report, dingpan.
 * - Web topic holds the full work product.
 * - DingTalk / IM is only a **relay channel**: short conclusions + real dingpan URL
 *   (cannot render Artifacts / inline HTML).
 *
 * This module is the single post-completion transform for both local AgentBridge
 * and queue BotCallback paths.
 */

import { type DeliveryClaimMessage, extractDingpanUploadOutcomes } from '@lobechat/agent-runtime';

import { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';

import {
  scrubFakeUploadProgressNarration,
  shouldEnsureDingpanForBotReply,
} from './botDingpanDeliveryHeuristic';
import { ensureDingpanDeliverable } from './ensureDingpanDeliverable';

const MISSING_REPORT_NOTE =
  '说明：本轮未能上传钉盘报告（系统补交付也未成功）。请到 YidaLab 打开同一话题查看中间结果后重试。';

const MAX_RELAY_CHARS = 1200;

const hasDingpanUrl = (text: string) =>
  /qr\.dingtalk\.com|previewDentry|yunpan\?route=preview/i.test(text);

const extractFirstDingpanUrl = (text: string): string | undefined => {
  const m = text.match(
    /https:\/\/qr\.dingtalk\.com\/page\/yunpan[^\s)\]>"']+|https:\/\/[^\s)\]>"']*previewDentry[^\s)\]>"']*/,
  );
  return m?.[0];
};

/**
 * Keep a short plain-text relay for IM. Prefer bullets / conclusion blocks.
 */
export const compactBotRelayText = (reply: string, maxChars = MAX_RELAY_CHARS): string => {
  let text = reply.trim();
  if (!text) return text;

  // Drop markdown link wrappers → bare URL (IM has no MD)
  text = text.replaceAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '$2');

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

/**
 * Single exit for bot → IM text after agent completion.
 */
export async function prepareBotOutboundReply(params: {
  db: LobeChatDatabase;
  reply: string;
  topicId?: string | null;
  userId: string;
  workspaceId?: string | null;
}): Promise<string> {
  const { db, userId, workspaceId, topicId } = params;
  let reply = scrubFakeUploadProgressNarration(params.reply);
  if (!reply.trim()) return reply;

  try {
    if (topicId) {
      const messageModel = new MessageModel(db, userId, workspaceId ?? undefined);
      const rows = await messageModel.findRecentDingpanUploadsInTopic(topicId);
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
      const latestOk = [...outcomes].reverse().find((o) => o.success && o.previewUrl);

      if (latestOk?.previewUrl) {
        if (!reply.includes(latestOk.previewUrl)) {
          reply = `${reply.trim()}\n\n钉盘报告：\n${latestOk.previewUrl}`;
        }
        // Same work as Web; IM only gets a compact relay + real link.
        return compactBotRelayText(reply);
      }
    }

    // Already has a dingpan URL in prose (model pasted it)
    if (hasDingpanUrl(reply)) {
      return compactBotRelayText(reply);
    }

    // Report-class without upload: system upload (not model-dependent).
    if (shouldEnsureDingpanForBotReply(reply) && topicId) {
      const ensured = await ensureDingpanDeliverable({
        db,
        reply,
        topicId,
        userId,
        workspaceId,
      });
      if (ensured.previewUrl) {
        reply = `${reply.trim()}\n\n钉盘报告：\n${ensured.previewUrl}`;
        return compactBotRelayText(reply);
      }
      if (
        reply.includes('未调用') ||
        reply.includes('uploadHtmlToDingpan') ||
        reply.includes(MISSING_REPORT_NOTE)
      ) {
        return compactBotRelayText(reply);
      }
      const failNote = ensured.error
        ? `${MISSING_REPORT_NOTE}\n原因：${ensured.error.slice(0, 160)}`
        : MISSING_REPORT_NOTE;
      return compactBotRelayText(`${reply.trim()}\n\n${failNote}`);
    }

    return compactBotRelayText(reply);
  } catch (error) {
    console.error('[prepareBotOutboundReply] non-fatal:', error);
    return compactBotRelayText(reply);
  }
}
