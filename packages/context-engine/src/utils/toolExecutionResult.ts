import {
  approxTokensFromText,
  EXTERNAL_TRUST,
  type ModelToolResultView,
  type PlatformArtifactRef,
  type TelemetryToolResultView,
  type ToolExecutionResult,
  type ToolResultCoverage,
  type ToolResultSource,
  type UIToolResultView,
} from '@lobechat/types';

const DEFAULT_MODEL_MAX_CHARS = 40_000;
const DEFAULT_TELEMETRY_MAX_CHARS = 2_048;

export interface BuildToolExecutionResultParams {
  artifact?: PlatformArtifactRef;
  coverage?: ToolResultCoverage;
  /** Structured payload for model (will be JSON.stringified + capped). */
  data?: unknown;
  durationMs?: number;
  error?: { message: string; type?: string };
  modelMaxChars?: number;
  /** Plain model text when not using `data`. */
  modelText?: string;
  nextCursor?: string;
  source?: ToolResultSource;
  success: boolean;
  truncated?: boolean;
  uiPreview?: unknown;
  uiSummary?: string;
}

/**
 * Build split tool views so model/UI/storage/logs never share one mega-string.
 * External trust is default (Excel / web / MCP-style bodies).
 */
export function buildToolExecutionResult(
  params: BuildToolExecutionResultParams,
): ToolExecutionResult {
  const modelMax = params.modelMaxChars ?? DEFAULT_MODEL_MAX_CHARS;
  let raw =
    params.modelText ?? (params.data !== undefined ? JSON.stringify(params.data, null, 0) : '');
  let truncated = Boolean(params.truncated);
  if (raw.length > modelMax) {
    raw = `${raw.slice(0, modelMax)}\n…[modelView truncated at ${modelMax} chars]`;
    truncated = true;
  }

  const modelView: ModelToolResultView = {
    content: raw,
    coverage: params.coverage,
    nextCursor: params.nextCursor,
    source: params.source,
    truncated,
    trust: EXTERNAL_TRUST,
  };

  const uiView: UIToolResultView = {
    downloadUrl: params.artifact ? undefined : undefined,
    nextCursor: params.nextCursor,
    preview: params.uiPreview,
    summary:
      params.uiSummary ||
      (params.success
        ? truncated
          ? `Result truncated (${approxTokensFromText(raw)} tok est.)`
          : 'OK'
        : params.error?.message || 'Failed'),
    truncated,
  };

  const telemetryPreview = (params.success ? raw : params.error?.message || 'error').slice(
    0,
    DEFAULT_TELEMETRY_MAX_CHARS,
  );
  const telemetryView: TelemetryToolResultView = {
    durationMs: params.durationMs,
    errorCode: params.error?.type,
    preview: telemetryPreview,
    success: params.success,
  };

  return {
    artifact: params.artifact,
    content: modelView.content,
    error: params.error,
    modelView,
    success: params.success,
    telemetryView,
    uiView,
  };
}

export function modelContentFromExecutionResult(result: ToolExecutionResult): string {
  return result.modelView?.content ?? result.content ?? '';
}
