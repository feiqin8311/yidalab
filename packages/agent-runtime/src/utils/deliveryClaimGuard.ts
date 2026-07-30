/**
 * Deterministic delivery claim guard for high-trust tool outputs (钉盘).
 *
 * Models sometimes invent success + fake URLs when tool content is empty/failed.
 * Authority is always the tool message — never the assistant prose.
 */

export const DINGPAN_TOOL_IDENTIFIER = 'lobe-dingpan';
export const DINGPAN_UPLOAD_APIS = new Set(['uploadHtmlToDingpan', 'uploadToDingpan']);

const CLAIM_RE =
  /已上传|上传至钉盘|上传到钉盘|上传钉盘|钉盘链接|HTML\s*报告已生成并上传|已生成并上传/i;

const MD_LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

export type DeliveryClaimMessage = {
  content?: unknown;
  plugin?: { apiName?: string; identifier?: string } | null;
  role?: string;
};

export type DingpanUploadOutcome = {
  apiName: string;
  error?: string;
  previewUrl?: string;
  success: boolean;
};

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const parseToolPayload = (content: string): Record<string, unknown> | null => {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'string') {
      try {
        return asObject(JSON.parse(parsed));
      } catch {
        return null;
      }
    }
    return asObject(parsed);
  } catch {
    return null;
  }
};

/**
 * Collect dingpan upload outcomes from runtime state messages (latest last).
 */
export const extractDingpanUploadOutcomes = (
  messages: DeliveryClaimMessage[],
): DingpanUploadOutcome[] => {
  const outcomes: DingpanUploadOutcome[] = [];

  for (const message of messages) {
    if (message.role !== 'tool') continue;
    const identifier = message.plugin?.identifier;
    const apiName = message.plugin?.apiName;
    if (identifier !== DINGPAN_TOOL_IDENTIFIER) continue;
    if (!apiName || !DINGPAN_UPLOAD_APIS.has(apiName)) continue;

    const raw = typeof message.content === 'string' ? message.content : '';
    const payload = parseToolPayload(raw);
    const previewUrl = String(payload?.preview_url ?? payload?.previewUrl ?? '').trim();
    const explicitSuccess = payload?.success === true;
    const explicitFailure = payload?.success === false;
    const errorText = String(
      payload?.error ??
        (typeof payload?.message === 'string' ? payload.message : '') ??
        raw.slice(0, 200),
    ).trim();

    if (explicitSuccess || (previewUrl.includes('qr.dingtalk.com') && !explicitFailure)) {
      outcomes.push({
        apiName,
        previewUrl: previewUrl || undefined,
        success: Boolean(previewUrl),
        ...(previewUrl ? {} : { error: errorText || 'missing preview_url' }),
      });
      continue;
    }

    outcomes.push({
      apiName,
      error:
        errorText ||
        (raw.trim()
          ? 'Dingpan tool returned a non-success payload'
          : 'Dingpan tool returned empty result'),
      success: false,
    });
  }

  return outcomes;
};

const claimsDingpanDelivery = (content: string): boolean =>
  CLAIM_RE.test(content) || /钉盘/.test(content);

/**
 * Rewrite final assistant text so delivery claims match tool authority.
 * No-op when this turn never used dingpan upload tools.
 */
export const applyDingpanDeliveryClaimGuard = (
  content: string,
  messages: DeliveryClaimMessage[],
): string => {
  if (typeof content !== 'string') return content;

  const outcomes = extractDingpanUploadOutcomes(messages);
  if (outcomes.length === 0) return content;

  const latest = outcomes.at(-1)!;

  if (latest.success && latest.previewUrl) {
    let next = content;

    // When the model claims 钉盘 delivery, rewrite wrong hosts to tool authority.
    if (claimsDingpanDelivery(content)) {
      next = content.replaceAll(MD_LINK_RE, (full, label: string, url: string) => {
        if (url.includes('qr.dingtalk.com') || url === latest.previewUrl) return full;
        return `[${label?.trim() || '打开钉盘预览'}](${latest.previewUrl})`;
      });
    }

    // Always surface the real preview_url once upload succeeded (model often forgets).
    if (!next.includes(latest.previewUrl)) {
      next = `${next.trim()}\n\n[打开钉盘预览](${latest.previewUrl})`;
    }
    return next;
  }

  // Failed / empty tool result: never let "已上传" stand.
  if (CLAIM_RE.test(content) || /已上传|上传至|上传到/.test(content)) {
    const err = latest.error || '钉盘上传未成功（工具未返回 preview_url）';
    return `钉盘上传失败：${err}\n\n请重试，或检查公司 DingTalk 凭证与个人文件夹配置。`;
  }

  return content;
};

/** Normalize empty tool content so the model never sees a silent blank tool message. */
export const normalizeEmptyToolContent = (
  content: string | undefined | null,
  error?: { message?: string } | null,
): string => {
  if (typeof content === 'string' && content.length > 0) return content;
  const message = error?.message?.trim() || 'Tool returned empty result';
  return JSON.stringify({ error: message, success: false, synthetic: true });
};
