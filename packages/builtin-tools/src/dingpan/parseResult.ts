/**
 * Normalize dingpan upload tool output (pluginState + JSON content).
 * State uses camelCase; tool content JSON uses snake_case.
 */
export type DingpanUploadResult = {
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
  const previewUrl = String(state.previewUrl ?? body.preview_url ?? body.previewUrl ?? '').trim();

  const explicitSuccess = state.success === true || body.success === true;
  const explicitFailure = state.success === false || body.success === false;
  const success =
    !explicitFailure && (explicitSuccess || Boolean(previewUrl && previewUrl.startsWith('http')));

  let errorText: string | undefined;
  if (!success) {
    const fromBody =
      (typeof body.error === 'string' && body.error) ||
      (typeof body.message === 'string' && body.message) ||
      '';
    if (fromBody) errorText = fromBody;
    else if (typeof content === 'string' && content.trim() && !parseContentObject(content)) {
      errorText = content.trim().slice(0, 500);
    }
  }

  return {
    ...(documentId ? { documentId } : {}),
    ...(errorText ? { errorText } : {}),
    ...(name ? { name } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    success,
  };
};
