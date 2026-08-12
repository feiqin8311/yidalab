/**
 * Deterministic delivery claim guard for high-trust tool outputs (钉盘).
 *
 * Models sometimes invent success + fake URLs when tool content is empty/failed.
 * Authority is always the tool message — never the assistant prose.
 */

import {
  isTrustedDingpanPreviewUrl,
  parseTrustedDingpanPreviewUrl,
  type TrustedDingpanPreview,
} from '@lobechat/types';

export const DINGPAN_TOOL_IDENTIFIER = 'lobe-dingpan';
export const DINGPAN_UPLOAD_APIS = new Set(['uploadHtmlToDingpan', 'uploadToDingpan']);

/** Re-export shared strict preview parser (single source of truth in @lobechat/types). */
export { isTrustedDingpanPreviewUrl, parseTrustedDingpanPreviewUrl };
export type { TrustedDingpanPreview };

const CLAIM_RE =
  /已上传|上传至钉盘|上传到钉盘|上传钉盘|钉盘链接|HTML\s*报告已生成并上传|已生成并上传/i;

const MD_LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
/** Bare https URLs that may be wrong dingpan hosts. */
const BARE_URL_RE = /https?:\/\/[^\s)\]>"']+/g;

export type DeliveryClaimMessage = {
  content?: unknown;
  plugin?: { apiName?: string; identifier?: string } | null;
  role?: string;
};

export type DingpanUploadOutcome = {
  apiName: string;
  error?: string;
  fileId?: string;
  previewUrl?: string;
  spaceId?: string;
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
    const previewRaw = String(payload?.preview_url ?? payload?.previewUrl ?? '').trim();
    const trusted = parseTrustedDingpanPreviewUrl(previewRaw);
    const explicitSuccess = payload?.success === true;
    const explicitFailure = payload?.success === false;
    const errorText = String(
      payload?.error ??
        (typeof payload?.message === 'string' ? payload.message : '') ??
        raw.slice(0, 200),
    ).trim();

    if (!explicitFailure && trusted && (explicitSuccess || Boolean(trusted.previewUrl))) {
      outcomes.push({
        apiName,
        fileId: trusted.fileId,
        previewUrl: trusted.previewUrl,
        spaceId: trusted.spaceId,
        success: true,
      });
      continue;
    }

    outcomes.push({
      apiName,
      error:
        errorText ||
        (previewRaw && !trusted
          ? 'Dingpan tool returned untrusted preview_url'
          : raw.trim()
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
    const authority = latest.previewUrl;
    let next = content;

    // Only the exact tool-authority URL may remain; any other dingpan-shaped or
    // foreign link is rewritten to the verified tool result.
    if (claimsDingpanDelivery(content)) {
      next = content.replaceAll(MD_LINK_RE, (full, label: string, url: string) => {
        if (url === authority) return full;
        return `[${label?.trim() || '打开钉盘预览'}](${authority})`;
      });
      next = next.replaceAll(BARE_URL_RE, (url: string) => {
        if (url === authority) return url;
        // Replace other dingpan-shaped / http links that appear as delivery claims.
        if (isTrustedDingpanPreviewUrl(url) || /dingtalk|yunpan|previewDentry/i.test(url)) {
          return authority;
        }
        return url;
      });
    }

    // Always surface the real preview_url once upload succeeded (model often forgets).
    if (!next.includes(authority)) {
      next = `${next.trim()}\n\n[打开钉盘预览](${authority})`;
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
  error?: { message?: string } | null | unknown,
): string => {
  if (typeof content === 'string' && content.length > 0) return content;
  const errMsg =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '').trim()
      : '';
  const message = errMsg || 'Tool returned empty result';
  return JSON.stringify({ error: message, success: false, synthetic: true });
};
