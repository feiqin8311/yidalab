/**
 * Trusted delivery outcome — model "done" ≠ system success.
 * Only after result is persisted + verified may outcomeStatus be `verified`.
 */

export const OPERATION_OUTCOME_STATUSES = [
  /** No deliverable expected for this operation. */
  'not_required',
  /** Delivery accepted / queued, not yet verified. */
  'pending',
  /** Artifact persisted and verified (e.g. dingpan metadata OK). */
  'verified',
  /** Terminal delivery failure (retryable may still be true). */
  'failed',
  /** Explicitly skipped (user cancel / non-report path). */
  'skipped',
] as const;

export type OperationOutcomeStatus = (typeof OPERATION_OUTCOME_STATUSES)[number];

export const OPERATION_OUTCOME_TYPES = [
  'text',
  'artifact',
  'dingpan',
  'bot_relay',
  'task',
  'unknown',
] as const;

export type OperationOutcomeType = (typeof OPERATION_OUTCOME_TYPES)[number];

export const DELIVERY_ATTEMPT_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'canceled',
] as const;

export type DeliveryAttemptStatus = (typeof DELIVERY_ATTEMPT_STATUSES)[number];

export const DELIVERY_TYPES = ['dingpan-report', 'dingpan-file', 'bot-webhook'] as const;

export type DeliveryType = (typeof DELIVERY_TYPES)[number];

/** Terminal operation outcome projection (also denormalized on agent_operations). */
export interface OperationOutcome {
  artifactId?: string;
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  outcomeType: OperationOutcomeType;
  previewUrl?: string;
  retryable?: boolean;
  status: OperationOutcomeStatus;
  verificationStatus: OperationOutcomeStatus;
}

/** Unique key for dingpan report delivery outbox rows. */
export const dingpanDeliveryDedupeKey = (
  operationId: string,
  deliveryType: DeliveryType = 'dingpan-report',
  targetFolder = 'default',
  artifactHash = 'report',
) => `${operationId}:${deliveryType}:${targetFolder}:${artifactHash}`;

export type TrustedDingpanPreview = {
  fileId: string;
  previewUrl: string;
  spaceId: string;
};

/**
 * Strict preview URL authority for report delivery.
 * HTTPS + exact host + fixed path/route + spaceId/fileId + type=file only.
 * Rejects open-redirects, folder links, and substring spoofs.
 */
export const parseTrustedDingpanPreviewUrl = (url: string): TrustedDingpanPreview | null => {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (u.hostname !== 'qr.dingtalk.com') return null;
    if (u.pathname !== '/page/yunpan') return null;
    if (u.searchParams.get('route') !== 'previewDentry') return null;
    const spaceId = (u.searchParams.get('spaceId') ?? '').trim();
    const fileId = (u.searchParams.get('fileId') ?? '').trim();
    const type = (u.searchParams.get('type') ?? '').trim();
    if (!spaceId || !fileId) return null;
    // Report delivery is always a file dentry — folders are not deliverables.
    if (type !== 'file') return null;
    return {
      fileId,
      previewUrl: `https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=${encodeURIComponent(spaceId)}&fileId=${encodeURIComponent(fileId)}&type=file`,
      spaceId,
    };
  } catch {
    return null;
  }
};

export const isTrustedDingpanPreviewUrl = (url: string): boolean =>
  Boolean(parseTrustedDingpanPreviewUrl(url));
