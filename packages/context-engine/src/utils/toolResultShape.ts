import { approxTokensFromText } from '@lobechat/types';

/** Default single-result token budget for model-facing tool content. */
export const DEFAULT_MAX_TOOL_RESULT_TOKENS = 8_000;
/** Default per-round total token budget across parallel tool results. */
export const DEFAULT_MAX_TOOL_ROUND_TOKENS = 20_000;
/** Floor receipt size so a result is never emptied. */
export const MIN_TOOL_RESULT_RECEIPT_TOKENS = 512;
const CHARS_PER_TOKEN = 4;

const tokensToChars = (tokens: number) => Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN));

export interface McpEnvelope {
  content: unknown;
  state?: unknown;
  success?: boolean;
}

/**
 * Strict MCP envelope unwrap: only when shape is { content, state?, success? }
 * and state.content blocks duplicate the inner text payload.
 * Ordinary business JSON is left unchanged.
 */
export const unwrapMcpEnvelope = (raw: unknown): { content: unknown; unwrapped: boolean } => {
  if (raw === null || raw === undefined) return { content: raw, unwrapped: false };
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return { content: raw, unwrapped: false };
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const unwrapped = unwrapMcpEnvelope(parsed);
      if (unwrapped.unwrapped) {
        return {
          content:
            typeof unwrapped.content === 'string'
              ? unwrapped.content
              : JSON.stringify(unwrapped.content),
          unwrapped: true,
        };
      }
      return { content: raw, unwrapped: false };
    } catch {
      return { content: raw, unwrapped: false };
    }
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { content: raw, unwrapped: false };
  }

  const obj = raw as Record<string, unknown>;
  if (!('content' in obj)) return { content: raw, unwrapped: false };
  if (!('success' in obj) && !('state' in obj)) return { content: raw, unwrapped: false };

  // Gate first: only known envelope keys. Domain JSON with extra fields
  // (title, pagination, metadata, …) is never unwrapped — including the
  // state.content mirror shortcut below.
  const envelopeKeys = new Set(['content', 'state', 'success', 'error', 'executionTime']);
  if (!Object.keys(obj).every((k) => envelopeKeys.has(k))) {
    return { content: raw, unwrapped: false };
  }

  const hasSuccess = typeof obj.success === 'boolean';
  const hasState = obj.state !== undefined && typeof obj.state === 'object';
  if (!hasSuccess && !hasState) return { content: raw, unwrapped: false };

  // Mirror optimization: state.content[] text blocks that duplicate content.
  if (hasState) {
    const state = obj.state as Record<string, unknown>;
    if (Array.isArray(state.content)) {
      const textFromBlocks = state.content
        .map((b) =>
          b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string'
            ? (b as { text: string }).text
            : '',
        )
        .filter(Boolean)
        .join('\n\n');
      const inner =
        typeof obj.content === 'string'
          ? obj.content
          : obj.content !== undefined
            ? JSON.stringify(obj.content)
            : '';
      if (
        textFromBlocks &&
        (inner === textFromBlocks || inner.includes(textFromBlocks.slice(0, 80)))
      ) {
        return { content: obj.content, unwrapped: true };
      }
    }
  }

  if (hasSuccess) {
    return { content: obj.content, unwrapped: true };
  }

  return { content: raw, unwrapped: false };
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Structured JSON trim: keep keys, head+tail rows for arrays, re-serialize.
 * Never mid-string cut of JSON.
 */
export const shapeStructuredJson = (
  data: unknown,
  maxTokens: number,
): {
  content: string;
  coverage?: { returnedRows: number; totalRows?: number };
  truncated: boolean;
} => {
  const maxChars = tokensToChars(maxTokens);
  const full = typeof data === 'string' ? data : JSON.stringify(data);
  if (approxTokensFromText(full) <= maxTokens) {
    return { content: full, truncated: false };
  }

  // Try parse string payloads
  let value: unknown = data;
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data);
    } catch {
      return shapePlainText(data, maxTokens);
    }
  }

  if (Array.isArray(value)) {
    return shapeArray(value, maxTokens, maxChars);
  }

  if (isPlainObject(value)) {
    // Prefer common table shapes: { data: [], rows: [], items: [], results: [] }
    for (const key of ['data', 'rows', 'items', 'results', 'list', 'records']) {
      if (Array.isArray(value[key])) {
        const arr = value[key] as unknown[];
        const shaped = shapeArray(arr, Math.max(256, maxTokens - 64), maxChars - 200);
        const next = {
          ...value,
          [key]: JSON.parse(shaped.content),
          _coverage: {
            returnedRows: shaped.coverage?.returnedRows ?? 0,
            totalRows: arr.length,
            truncated: shaped.truncated,
          },
        };
        const out = JSON.stringify(next);
        if (approxTokensFromText(out) <= maxTokens) {
          return {
            content: out,
            coverage: { returnedRows: shaped.coverage?.returnedRows ?? 0, totalRows: arr.length },
            truncated: true,
          };
        }
      }
    }

    // Drop large nested values until under budget
    const keys = Object.keys(value);
    const slim: Record<string, unknown> = {};
    let used = 32;
    for (const k of keys) {
      const piece = JSON.stringify(value[k]);
      const cost = approxTokensFromText(piece) + approxTokensFromText(k) + 4;
      if (used + cost > maxTokens) {
        slim[k] = `[omitted ~${approxTokensFromText(piece)} tokens]`;
        used += 12;
        continue;
      }
      slim[k] = value[k];
      used += cost;
    }
    slim._truncated = true;
    return { content: JSON.stringify(slim), truncated: true };
  }

  return shapePlainText(full, maxTokens);
};

const shapeArray = (
  arr: unknown[],
  maxTokens: number,
  maxChars: number,
): {
  content: string;
  coverage: { returnedRows: number; totalRows: number };
  truncated: boolean;
} => {
  if (arr.length === 0) {
    return { content: '[]', coverage: { returnedRows: 0, totalRows: 0 }, truncated: false };
  }

  // head + tail rows
  let head = Math.min(arr.length, 20);
  let tail = 0;
  while (head > 1) {
    const sample =
      tail > 0
        ? [
            ...arr.slice(0, head),
            { _ellipsis: `… ${arr.length - head - tail} rows omitted …` },
            ...arr.slice(-tail),
          ]
        : arr.slice(0, head);
    const s = JSON.stringify(sample);
    if (s.length <= maxChars && approxTokensFromText(s) <= maxTokens) {
      const returned = head + tail;
      return {
        content: s,
        coverage: { returnedRows: Math.min(returned, arr.length), totalRows: arr.length },
        truncated: returned < arr.length,
      };
    }
    if (tail === 0 && head > 4) {
      tail = Math.min(5, Math.floor(head / 4));
      head = Math.max(2, head - tail);
    } else {
      head = Math.max(1, Math.floor(head / 2));
      tail = Math.min(tail, Math.floor(head / 2));
    }
  }

  const minimal = [arr[0], { _ellipsis: `… ${arr.length - 2} rows omitted …` }, arr.at(-1)];
  return {
    content: JSON.stringify(minimal).slice(0, maxChars),
    coverage: { returnedRows: 2, totalRows: arr.length },
    truncated: true,
  };
};

/**
 * Logs / shell: keep head + tail; prefer error lines when present.
 */
export const shapePlainText = (
  text: string,
  maxTokens: number,
): { content: string; truncated: boolean } => {
  if (approxTokensFromText(text) <= maxTokens) {
    return { content: text, truncated: false };
  }

  const maxChars = tokensToChars(maxTokens);
  const headBudget = Math.floor(maxChars * 0.6);
  const tailBudget = Math.floor(maxChars * 0.35);
  const head = text.slice(0, headBudget);
  const tail = text.slice(-tailBudget);
  const omitted = text.length - head.length - tail.length;
  return {
    content: `${head}\n…[${omitted} chars omitted]…\n${tail}`,
    truncated: true,
  };
};

export interface ShapeToolResultForModelParams {
  /** Soft char hard-cap (legacy toolResultMaxLength). */
  maxChars?: number;
  maxTokens?: number;
  raw: unknown;
  success?: boolean;
}

export interface ShapeToolResultForModelOutcome {
  content: string;
  coverage?: { returnedRows: number; totalRows?: number };
  originalTokens: number;
  truncated: boolean;
  unwrapped: boolean;
}

/**
 * Full pipeline: MCP unwrap → structured or plain shape → dual char/token cap.
 */
export const shapeToolResultForModel = (
  params: ShapeToolResultForModelParams,
): ShapeToolResultForModelOutcome => {
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOOL_RESULT_TOKENS;
  const { content: unwrappedContent, unwrapped } = unwrapMcpEnvelope(params.raw);

  const asString =
    typeof unwrappedContent === 'string'
      ? unwrappedContent
      : unwrappedContent === undefined || unwrappedContent === null
        ? ''
        : JSON.stringify(unwrappedContent);

  const originalTokens = approxTokensFromText(asString);

  // Prefer structured path for JSON-looking payloads
  let shaped: {
    content: string;
    coverage?: { returnedRows: number; totalRows?: number };
    truncated: boolean;
  };
  const trimmed = asString.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    shaped = shapeStructuredJson(unwrappedContent, maxTokens);
  } else {
    shaped = shapePlainText(asString, maxTokens);
  }

  // Legacy char hard-cap still applies
  if (params.maxChars && params.maxChars > 0 && shaped.content.length > params.maxChars) {
    const plain = shapePlainText(shaped.content, Math.floor(params.maxChars / CHARS_PER_TOKEN));
    shaped = { ...shaped, content: plain.content, truncated: true };
  }

  return {
    content: shaped.content,
    coverage: shaped.coverage,
    originalTokens,
    truncated: shaped.truncated || originalTokens > maxTokens,
    unwrapped,
  };
};

/**
 * Allocate per-result token budgets for a round of N results.
 * Guarantees each item at least MIN_TOOL_RESULT_RECEIPT_TOKENS, then splits remainder.
 */
export const allocateRoundToolBudgets = (
  count: number,
  roundMaxTokens: number = DEFAULT_MAX_TOOL_ROUND_TOKENS,
  perResultMax: number = DEFAULT_MAX_TOOL_RESULT_TOKENS,
): number[] => {
  if (count <= 0) return [];
  const floor = MIN_TOOL_RESULT_RECEIPT_TOKENS;
  const minTotal = floor * count;
  if (roundMaxTokens <= minTotal) {
    return Array.from({ length: count }, () => Math.max(1, Math.floor(roundMaxTokens / count)));
  }
  const remaining = roundMaxTokens - minTotal;
  const share = Math.floor(remaining / count);
  return Array.from({ length: count }, () => Math.min(perResultMax, floor + share));
};

export interface RoundToolResultItem {
  apiName?: string;
  content: string;
  identifier?: string;
  success?: boolean;
  toolCallId?: string;
}

/**
 * Rebalance a batch of tool result strings so total tokens ≤ maxToolRoundTokens.
 * Shrinks largest first; never goes below receipt floor.
 */
export const applyRoundToolResultBudgets = (
  items: RoundToolResultItem[],
  maxToolRoundTokens: number = DEFAULT_MAX_TOOL_ROUND_TOKENS,
): Array<RoundToolResultItem & { reshaped: boolean }> => {
  if (items.length === 0) return [];

  const working = items.map((item) => ({
    ...item,
    content: item.content ?? '',
    reshaped: false,
    tokens: approxTokensFromText(item.content ?? ''),
  }));

  let total = working.reduce((s, i) => s + i.tokens, 0);
  if (total <= maxToolRoundTokens) return working;

  // Sort indices by size desc
  const order = working
    .map((item, index) => ({ index, tokens: item.tokens }))
    .sort((a, b) => b.tokens - a.tokens);

  for (const { index } of order) {
    if (total <= maxToolRoundTokens) break;
    const item = working[index];
    const excess = total - maxToolRoundTokens;
    const target = Math.max(MIN_TOOL_RESULT_RECEIPT_TOKENS, item.tokens - excess);
    if (target >= item.tokens) continue;

    const shaped = shapeToolResultForModel({
      maxTokens: target,
      raw: item.content,
      success: item.success,
    });
    const nextTokens = approxTokensFromText(shaped.content);
    total -= item.tokens - nextTokens;
    working[index] = {
      ...item,
      content: shaped.content,
      reshaped: true,
      tokens: nextTokens,
    };
  }

  // Still over → force receipts on oldest-large remaining
  if (total > maxToolRoundTokens) {
    for (const { index } of order) {
      if (total <= maxToolRoundTokens) break;
      const item = working[index];
      if (item.tokens <= MIN_TOOL_RESULT_RECEIPT_TOKENS) continue;
      const receipt = buildToolResultReceipt({
        apiName: item.apiName,
        identifier: item.identifier,
        originalTokens: item.tokens,
        success: item.success !== false,
        toolCallId: item.toolCallId,
      });
      const nextTokens = approxTokensFromText(receipt);
      total -= item.tokens - nextTokens;
      working[index] = {
        ...item,
        content: receipt,
        reshaped: true,
        tokens: nextTokens,
      };
    }
  }

  return working.map(({ tokens: _t, ...rest }) => rest);
};

/**
 * Compact receipt for historical micro-prune (model view only).
 */
export const buildToolResultReceipt = (opts: {
  apiName?: string;
  artifactPath?: string;
  coverage?: { returnedRows: number; totalRows?: number };
  errorCode?: string;
  identifier?: string;
  originalTokens: number;
  success: boolean;
  toolCallId?: string;
}): string => {
  const parts = [
    `[tool_receipt]`,
    opts.identifier ? `tool=${opts.identifier}` : null,
    opts.apiName ? `api=${opts.apiName}` : null,
    opts.toolCallId ? `call=${opts.toolCallId}` : null,
    `success=${opts.success}`,
    opts.errorCode ? `error=${opts.errorCode}` : null,
    `tokens≈${opts.originalTokens}`,
    opts.coverage
      ? `rows=${opts.coverage.returnedRows}${opts.coverage.totalRows != null ? `/${opts.coverage.totalRows}` : ''}`
      : null,
    opts.artifactPath ? `artifact=${opts.artifactPath}` : null,
    `hint=full body pruned from model context; re-read via artifact/document if needed`,
  ].filter(Boolean);
  return parts.join(' ');
};
