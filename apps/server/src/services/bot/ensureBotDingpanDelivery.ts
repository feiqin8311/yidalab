import { type DeliveryClaimMessage, extractDingpanUploadOutcomes } from '@lobechat/agent-runtime';

import { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';

import {
  appendBotDingpanPreviewLink,
  shouldEnsureDingpanForBotReply,
} from './botDingpanDeliveryHeuristic';

export {
  appendBotDingpanPreviewLink,
  shouldEnsureDingpanForBotReply,
  wrapBotReplyAsHtml,
} from './botDingpanDeliveryHeuristic';

const MISSING_REPORT_NOTE_PLAIN =
  '说明：本轮未调用钉盘上传完整 HTML 报告（与 Web 同质量的报告需先 uploadHtmlToDingpan）。请重试该问题，或在 Web 打开同一话题查看。';

/**
 * Bot IM cannot render Artifacts.
 * - If this topic already has a successful dingpan upload → always surface preview_url.
 * - If the model skipped upload on a report-class answer → do NOT invent a low-quality
 *   text snapshot as "完整报告"; append an explicit missing-report note instead.
 */
export async function ensureBotDingpanDelivery(params: {
  db: LobeChatDatabase;
  plainText?: boolean;
  reply: string;
  topicId?: string | null;
  userId: string;
  workspaceId?: string | null;
}): Promise<string> {
  const { db, userId, workspaceId, topicId, plainText = true } = params;
  const reply = params.reply;
  if (!topicId || !reply.trim()) return reply;

  try {
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
      return appendBotDingpanPreviewLink(reply, latestOk.previewUrl, plainText);
    }

    if (!shouldEnsureDingpanForBotReply(reply)) return reply;

    if (reply.includes('未调用钉盘上传') || reply.includes('uploadHtmlToDingpan')) return reply;

    return `${reply.trim()}\n\n${MISSING_REPORT_NOTE_PLAIN}`;
  } catch (error) {
    console.error('[ensureBotDingpanDelivery] non-fatal:', error);
    return reply;
  }
}
