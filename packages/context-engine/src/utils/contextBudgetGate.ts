/**
 * Final preflight gate before a provider call.
 * Compress must not be the only defense against oversized attachment context.
 */

export interface ContextBudgetGateInput {
  /** Approximate token count of the assembled request (messages + tools + system). */
  estimatedTokens: number;
  /** Hard ceiling (usually model context window minus output reserve). */
  maxTokens: number;
  /** Optional soft target; when exceeded, recommend dropping attachment cards. */
  softTokens?: number;
}

export type ContextBudgetGateDecision =
  | { action: 'allow' }
  | { action: 'strip_file_bodies'; reason: string }
  | { action: 'reject'; reason: string };

/**
 * Conservative token estimate: CJK / fullwidth ~1 token per char,
 * other code points ~1 token per 4 chars (ASCII/Latin bias).
 * Intentionally over-estimates vs naive length/4 so Chinese + JSON are safer.
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // CJK Unified + Hangul + Kana + fullwidth forms (rough)
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return cjk + Math.ceil(other / 4);
}

export function estimateTokensFromMessages(messages: Array<{ content?: unknown }>): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') total += estimateTokensFromText(m.content);
    else if (Array.isArray(m.content)) {
      for (const p of m.content as Array<{ text?: string; type?: string }>) {
        if (p?.type === 'text' && typeof p.text === 'string') {
          total += estimateTokensFromText(p.text);
        } else if (typeof (p as { text?: string }).text === 'string') {
          total += estimateTokensFromText((p as { text: string }).text);
        }
      }
    }
    // per-message overhead (role / framing)
    total += 8;
  }
  return total;
}

export function evaluateContextBudgetGate(
  input: ContextBudgetGateInput,
): ContextBudgetGateDecision {
  const { estimatedTokens, maxTokens, softTokens } = input;
  if (maxTokens <= 0) return { action: 'allow' };

  if (estimatedTokens > maxTokens) {
    return {
      action: 'reject',
      reason: `Context estimate ${estimatedTokens} exceeds hard budget ${maxTokens}`,
    };
  }

  const soft = softTokens ?? Math.floor(maxTokens * 0.92);
  if (estimatedTokens > soft) {
    return {
      action: 'strip_file_bodies',
      reason: `Context estimate ${estimatedTokens} exceeds soft budget ${soft}; strip attachment bodies to fileId-only cards`,
    };
  }

  return { action: 'allow' };
}

/** Strip file bodies from filesPrompts-style content while keeping ids. */
export function stripInlineFileBodiesFromText(text: string): string {
  return text.replaceAll(
    /<file\b([^>]*)>([\s\S]*?)<\/file>/g,
    (_m, attrs: string) =>
      `<file${attrs}>[body stripped by context budget gate — use lobe-workbook tools with file id]</file>`,
  );
}

export function stripFileBodiesFromMessages<T extends { content?: unknown }>(messages: T[]): T[] {
  return messages.map((m) => {
    if (typeof m.content === 'string' && m.content.includes('<file')) {
      return { ...m, content: stripInlineFileBodiesFromText(m.content) };
    }
    if (Array.isArray(m.content)) {
      const parts = (m.content as Array<{ text?: string; type?: string }>).map((p) =>
        p?.type === 'text' && typeof p.text === 'string' && p.text.includes('<file')
          ? { ...p, text: stripInlineFileBodiesFromText(p.text) }
          : p,
      );
      return { ...m, content: parts };
    }
    return m;
  });
}

/** Default input budget when model window is unknown (conservative). */
export const DEFAULT_CONTEXT_INPUT_BUDGET = 100_000;
export const DEFAULT_OUTPUT_RESERVE = 8192;

/** Derive hard input budget from context window. */
export function inputBudgetFromContextWindow(
  contextWindow?: number,
  outputReserve = DEFAULT_OUTPUT_RESERVE,
): number {
  if (!contextWindow || contextWindow <= 0) return DEFAULT_CONTEXT_INPUT_BUDGET;
  return Math.max(1024, contextWindow - outputReserve);
}
