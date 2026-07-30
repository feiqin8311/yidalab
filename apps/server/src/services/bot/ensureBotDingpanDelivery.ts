import { type DeliveryClaimMessage, extractDingpanUploadOutcomes } from '@lobechat/agent-runtime';

import { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';
import { dingpanRuntime } from '@/server/services/toolExecution/serverRuntimes/dingpan';

import {
  appendBotDingpanPreviewLink,
  shouldEnsureDingpanForBotReply,
  wrapBotReplyAsHtml,
} from './botDingpanDeliveryHeuristic';

export {
  appendBotDingpanPreviewLink,
  shouldEnsureDingpanForBotReply,
  wrapBotReplyAsHtml,
} from './botDingpanDeliveryHeuristic';

/**
 * Bot IM cannot render Artifacts. If the turn already uploaded HTML to 钉盘,
 * always surface preview_url. If the model skipped upload for a report-length
 * answer, upload a minimal HTML snapshot so DingTalk still gets a link.
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

    const runtime = dingpanRuntime.factory({
      serverDB: db,
      topicId,
      userId,
      workspaceId: workspaceId ?? undefined,
    }) as { uploadHtmlToDingpan?: (args: Record<string, unknown>) => Promise<unknown> };

    if (typeof runtime.uploadHtmlToDingpan !== 'function') return reply;

    const title = `IM报告_${new Date().toISOString().slice(0, 10)}`;
    const result = (await runtime.uploadHtmlToDingpan({
      html: wrapBotReplyAsHtml(reply, title),
      taskType: 'IM报告',
      title,
      topicId,
    })) as {
      content?: string;
      previewUrl?: string;
      preview_url?: string;
      success?: boolean;
    };

    const previewUrl = String(result?.preview_url ?? result?.previewUrl ?? '').trim();
    // Runtime may return JSON string in content
    let fromContent = '';
    if (!previewUrl && typeof result?.content === 'string') {
      try {
        const parsed = JSON.parse(result.content) as Record<string, unknown>;
        fromContent = String(parsed.preview_url ?? parsed.previewUrl ?? '').trim();
      } catch {
        // ignore
      }
    }
    const url = previewUrl || fromContent;
    if (url && (result?.success !== false || url.includes('qr.dingtalk.com'))) {
      return appendBotDingpanPreviewLink(reply, url, plainText);
    }

    return reply;
  } catch (error) {
    console.error('[ensureBotDingpanDelivery] non-fatal:', error);
    return reply;
  }
}
