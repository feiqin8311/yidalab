/**
 * Normalize dingpan upload tool output (pluginState + JSON content).
 * State uses camelCase; tool content JSON uses snake_case.
 * Success requires a strictly trusted preview URL (report file dentry only).
 */
import { parseTrustedDingpanPreviewUrl } from '@lobechat/types';

export type DingpanUploadResult = {
  deliveryAttemptId?: string;
  documentId?: string;
  /** Plain tool error / failure text when not JSON success. */
  errorText?: string;
  name?: string;
  previewUrl?: string;
  success: boolean;
};

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const parseContentObject = (content: unknown): Record<string, unknown> | null => {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed) return null;
    try {
      return asObject(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return asObject(content);
};

export const parseDingpanUploadResult = (
  content: unknown,
  pluginState?: Record<string, unknown> | null,
): DingpanUploadResult => {
  const state = asObject(pluginState) ?? {};
  const body = parseContentObject(content) ?? {};

  const documentId = String(state.documentId ?? body.document_id ?? body.documentId ?? '').trim();
  const name = String(state.name ?? body.name ?? '').trim();
  const previewRaw = String(state.previewUrl ?? body.preview_url ?? body.previewUrl ?? '').trim();
  const trusted = parseTrustedDingpanPreviewUrl(previewRaw);
  const deliveryAttemptId = String(
    state.deliveryAttemptId ?? body.delivery_attempt_id ?? body.deliveryAttemptId ?? '',
  ).trim();

  const explicitSuccess = state.success === true || body.success === true;
  const explicitFailure = state.success === false || body.success === false;
  // Never treat arbitrary http URLs as success — only strict dingpan file preview.
  const success = !explicitFailure && Boolean(trusted) && (explicitSuccess || Boolean(trusted));

  let errorText: string | undefined;
  if (!success) {
    const fromBody =
      (typeof body.error === 'string' && body.error) ||
      (typeof body.message === 'string' && body.message) ||
      '';
    if (fromBody) errorText = fromBody;
    else if (previewRaw && !trusted) errorText = 'Untrusted or invalid dingpan preview URL';
    else if (typeof content === 'string' && content.trim() && !parseContentObject(content)) {
      errorText = content.trim().slice(0, 500);
    }
  }

  return {
    ...(deliveryAttemptId ? { deliveryAttemptId } : {}),
    ...(documentId ? { documentId } : {}),
    ...(errorText ? { errorText } : {}),
    ...(name ? { name } : {}),
    ...(trusted ? { previewUrl: trusted.previewUrl } : {}),
    success,
  };
};
