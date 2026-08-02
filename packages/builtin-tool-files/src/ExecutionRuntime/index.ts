import type { BuiltinServerRuntimeOutput, ToolExecutionResult } from '@lobechat/types';
import { EXTERNAL_TRUST } from '@lobechat/types';

import type {
  InspectAttachmentParams,
  ReadAttachmentParams,
  SearchAttachmentParams,
} from '../types';

export interface AttachmentFileMeta {
  fileType: string;
  id: string;
  name: string;
  parseStatus?: string | null;
  processingPolicy?: string | null;
  size: number | null;
}

export interface AttachmentPage {
  content: string;
  pageNumber: number;
}

export interface AttachmentExtractResult {
  content?: string;
  pages?: AttachmentPage[];
  parseStatus?: string;
  status: 'ready' | 'partial' | 'unsupported' | 'failed';
  totalLength?: number;
  warnings: string[];
}

export interface FilesServiceBridge {
  /** Full extract without prompt-card caps (for read/search). */
  extractFull: (fileId: string) => Promise<AttachmentExtractResult>;
  /** ACL-checked metadata only — no download/parse. */
  getReadableFile: (fileId: string) => Promise<AttachmentFileMeta | null>;
}

const MODEL_MAX = 16_000;
const DEFAULT_READ_LIMIT = 4000;
const MAX_READ_LIMIT = 12_000;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 20;
const SNIPPET_RADIUS = 120;

/** Conservative MIME prefixes that usually yield extractable text. */
const LIKELY_TEXT_TYPES = [
  'text/',
  'application/json',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/rtf',
  'application/xml',
  'application/javascript',
  'application/typescript',
];

export class FilesExecutionRuntime {
  constructor(private readonly service: FilesServiceBridge) {}

  private toOutput(result: ToolExecutionResult): BuiltinServerRuntimeOutput {
    return {
      content: result.modelView.content,
      error: result.error,
      executionResult: result,
      state: result.uiView,
      success: result.success,
    };
  }

  private fail(error: unknown, code = 'FilesToolError'): BuiltinServerRuntimeOutput {
    const message = error instanceof Error ? error.message : String(error);
    const executionResult: ToolExecutionResult = {
      content: message,
      error: { message, type: code },
      modelView: {
        content: message,
        trust: EXTERNAL_TRUST,
      },
      success: false,
      telemetryView: {
        errorCode: code,
        preview: message.slice(0, 512),
        success: false,
      },
      uiView: { summary: message, truncated: false },
    };
    return this.toOutput(executionResult);
  }

  /**
   * Always return parseable JSON under MODEL_MAX — never slice mid-string.
   * Shrink heavy fields (content / matches) then re-stringify.
   * Returns final body so callers (readAttachment) can set nextOffset from
   * the content that was actually emitted after shrink.
   */
  private successJson(
    payload: Record<string, unknown>,
    uiSummary: string,
  ): { body: Record<string, unknown>; output: BuiltinServerRuntimeOutput } {
    const fileId = typeof payload.fileId === 'string' ? payload.fileId : undefined;
    let body: Record<string, unknown> = { ...payload };
    let content = JSON.stringify(body);
    let truncated = false;

    if (content.length > MODEL_MAX && typeof body.content === 'string') {
      // Capture immutable source text before body is replaced by shorter candidates.
      const rawContent = body.content;
      let lo = 0;
      let hi = rawContent.length;
      let best = '';
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const candidate = {
          ...body,
          content: rawContent.slice(0, mid),
          truncated: true,
          warning: 'modelView truncated to stay under size cap; use nextOffset / smaller limit',
        };
        const json = JSON.stringify(candidate);
        if (json.length <= MODEL_MAX) {
          best = json;
          body = candidate;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (best) {
        content = best;
        truncated = true;
      }
    }

    if (content.length > MODEL_MAX && Array.isArray(body.matches)) {
      let matches = body.matches as unknown[];
      while (matches.length > 0 && content.length > MODEL_MAX) {
        matches = matches.slice(0, -1);
        body = { ...body, matches, truncated: true };
        content = JSON.stringify(body);
      }
      truncated = true;
    }

    if (content.length > MODEL_MAX) {
      body = {
        fileId,
        success: true,
        truncated: true,
        warning: 'modelView truncated to stay under size cap; retry with smaller limit/offset',
      };
      content = JSON.stringify(body);
      truncated = true;
    }

    const executionResult: ToolExecutionResult = {
      content,
      modelView: {
        content,
        source: { tool: 'lobe-files', ...(fileId ? { fileId } : {}) },
        truncated,
        trust: EXTERNAL_TRUST,
      },
      success: true,
      telemetryView: { preview: content.slice(0, 1024), success: true },
      uiView: { summary: uiSummary, truncated },
    };
    return { body, output: this.toOutput(executionResult) };
  }

  private async requireFile(
    fileId: string,
  ): Promise<
    { file: AttachmentFileMeta; ok: true } | { ok: false; output: BuiltinServerRuntimeOutput }
  > {
    if (!fileId?.trim()) {
      return { ok: false, output: this.fail(new Error('fileId is required'), 'INVALID_ARGS') };
    }
    const file = await this.service.getReadableFile(fileId);
    if (!file) {
      return {
        ok: false,
        output: this.fail(
          new Error(
            `Attachment "${fileId}" was not found, is not readable, or is not linked to this conversation. Pass a fileId from the current turn's <file> cards.`,
          ),
          'NOT_FOUND',
        ),
      };
    }
    return { file, ok: true };
  }

  private guessExtractable(fileType: string): 'likely' | 'unlikely' | 'unknown' {
    const t = (fileType || '').toLowerCase();
    if (!t || t === 'application/octet-stream') return 'unknown';
    if (LIKELY_TEXT_TYPES.some((p) => t.startsWith(p) || t.includes(p))) return 'likely';
    if (
      t.startsWith('image/') ||
      t.startsWith('video/') ||
      t.startsWith('audio/') ||
      t.includes('zip') ||
      t.includes('octet-stream')
    ) {
      return 'unlikely';
    }
    return 'unknown';
  }

  async inspectAttachment(args: InspectAttachmentParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const loaded = await this.requireFile(args.fileId);
      if (!loaded.ok) return loaded.output;

      const { file } = loaded;
      const extractable = this.guessExtractable(file.fileType);
      // Metadata only — no download/parse (avoids double-extract on inspect→read).
      return this.successJson(
        {
          extractable,
          fileId: file.id,
          fileType: file.fileType,
          name: file.name,
          parseStatus: file.parseStatus ?? 'uploaded',
          processingPolicy: file.processingPolicy ?? 'on_demand',
          size: file.size ?? 0,
          status: 'unparsed',
          tip: 'Metadata only. Call readAttachment(fileId, offset?, limit?, pages?) for text or searchAttachment for keywords. extractable is a MIME heuristic, not a parse result.',
          warnings: [] as string[],
        },
        `inspect ${file.name}: unparsed metadata`,
      ).output;
    } catch (error) {
      return this.fail(error);
    }
  }

  async readAttachment(args: ReadAttachmentParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const loaded = await this.requireFile(args.fileId);
      if (!loaded.ok) return loaded.output;

      const { file } = loaded;
      const extract = await this.service.extractFull(file.id);

      if (!extract.content?.trim() && !extract.pages?.length) {
        return this.fail(
          new Error(
            `Attachment "${file.name}" (${file.id}) has no extractable text (status=${extract.status}). ${extract.warnings.join('; ') || 'Unsupported or empty document.'}`,
          ),
          extract.status === 'unsupported' ? 'UNSUPPORTED' : 'NO_CONTENT',
        );
      }

      let text = extract.content || '';
      let pageFilterApplied = false;

      // Page filter: prefer structured pages from loaders (PDF uses pageNumber metadata).
      if (args.pages && args.pages.length > 0) {
        const pageSet = new Set(args.pages.map((p) => Math.floor(p)));
        pageFilterApplied = true;
        if (extract.pages?.length) {
          const selected = extract.pages.filter((p) => pageSet.has(p.pageNumber));
          if (selected.length === 0) {
            return this.fail(
              new Error(
                `No pages matched ${JSON.stringify(args.pages)} for "${file.name}". Available pageNumbers: ${extract.pages.map((p) => p.pageNumber).join(', ') || 'none'}.`,
              ),
              'PAGE_NOT_FOUND',
            );
          }
          text = selected.map((p) => p.content).join('\n\n');
        } else {
          // Fallback: split on form-feed or pageNumber= markers from PDF loader text.
          const pageBlocks = text.split(/(?=<page\b)/i).filter(Boolean);
          if (pageBlocks.length > 1) {
            const selected: string[] = [];
            for (const block of pageBlocks) {
              const m = block.match(/pageNumber=["']?(\d+)/i);
              const n = m ? Number(m[1]) : undefined;
              if (n !== undefined && pageSet.has(n)) selected.push(block);
            }
            if (selected.length === 0) {
              return this.fail(
                new Error(
                  `No pages matched ${JSON.stringify(args.pages)} for "${file.name}" (text markers).`,
                ),
                'PAGE_NOT_FOUND',
              );
            }
            text = selected.join('\n\n');
          } else {
            const parts = text.split(/\f/);
            if (parts.length > 1) {
              const selected: string[] = [];
              parts.forEach((part, index) => {
                if (pageSet.has(index + 1)) selected.push(part);
              });
              if (selected.length === 0) {
                return this.fail(
                  new Error(
                    `No pages matched ${JSON.stringify(args.pages)} for "${file.name}" (form-feed split).`,
                  ),
                  'PAGE_NOT_FOUND',
                );
              }
              text = selected.join('\n');
            } else {
              return this.fail(
                new Error(
                  `Attachment "${file.name}" has no page structure; pages= is not applicable. Read without pages.`,
                ),
                'PAGE_NOT_FOUND',
              );
            }
          }
        }
      }

      const offset = Math.max(0, Math.floor(args.offset ?? 0));
      const limit = Math.min(
        MAX_READ_LIMIT,
        Math.max(1, Math.floor(args.limit ?? DEFAULT_READ_LIMIT)),
      );
      if (offset >= text.length) {
        return this.successJson(
          {
            content: '',
            fileId: file.id,
            name: file.name,
            nextOffset: null,
            pageFilterApplied,
            parseStatus: extract.parseStatus ?? extract.status,
            totalLength: text.length,
            truncated: false,
            warnings: extract.warnings,
          },
          `read ${file.name}: offset beyond end`,
        ).output;
      }

      // Iterate until content + nextOffset both fit MODEL_MAX without further shrink.
      // Quote-heavy slices can force content shorter than `limit`; nextOffset must
      // always equal offset + emitted.length or pages silently drop characters.
      let candidate = text.slice(offset, offset + limit);
      let output = this.fail(new Error('readAttachment failed to size payload'), 'INTERNAL');
      for (let attempt = 0; attempt < 6; attempt++) {
        const nextOffset =
          offset + candidate.length < text.length ? offset + candidate.length : null;
        const sized = this.successJson(
          {
            content: candidate,
            fileId: file.id,
            name: file.name,
            nextOffset,
            pageFilterApplied,
            parseStatus: extract.parseStatus ?? extract.status,
            totalLength: text.length,
            truncated: nextOffset !== null,
            warnings: extract.warnings,
          },
          `read ${file.name}: ${candidate.length} chars @${offset}`,
        );
        output = sized.output;
        const emitted = typeof sized.body.content === 'string' ? sized.body.content : candidate;
        const bodyNext = sized.body.nextOffset as number | null | undefined;
        if (emitted === candidate && bodyNext === nextOffset) {
          return output;
        }
        // Shrunk again (e.g. nextOffset field pushed JSON over cap) — retry with shorter body.
        if (typeof sized.body.content !== 'string' || emitted.length === 0) {
          return output;
        }
        candidate = emitted;
      }
      return output;
    } catch (error) {
      return this.fail(error);
    }
  }

  async searchAttachment(args: SearchAttachmentParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const loaded = await this.requireFile(args.fileId);
      if (!loaded.ok) return loaded.output;

      const { file } = loaded;
      const query = args.query?.trim();
      if (!query) {
        return this.fail(new Error('query is required'), 'INVALID_ARGS');
      }

      const extract = await this.service.extractFull(file.id);
      if (!extract.content?.trim()) {
        return this.fail(
          new Error(
            `Attachment "${file.name}" (${file.id}) has no extractable text to search (status=${extract.status}).`,
          ),
          extract.status === 'unsupported' ? 'UNSUPPORTED' : 'NO_CONTENT',
        );
      }

      const limit = Math.min(
        MAX_SEARCH_LIMIT,
        Math.max(1, Math.floor(args.limit ?? DEFAULT_SEARCH_LIMIT)),
      );
      const haystack = extract.content;
      const lower = haystack.toLowerCase();
      const needle = query.toLowerCase();
      const matches: Array<{ offset: number; snippet: string }> = [];
      let from = 0;
      while (matches.length < limit) {
        const idx = lower.indexOf(needle, from);
        if (idx === -1) break;
        const start = Math.max(0, idx - SNIPPET_RADIUS);
        const end = Math.min(haystack.length, idx + needle.length + SNIPPET_RADIUS);
        const snippet = `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${end < haystack.length ? '…' : ''}`;
        matches.push({ offset: idx, snippet });
        from = idx + Math.max(needle.length, 1);
      }

      return this.successJson(
        {
          fileId: file.id,
          matches,
          name: file.name,
          query,
          totalLength: haystack.length,
          totalMatchesCapped: matches.length >= limit,
          warnings: extract.warnings,
        },
        `search ${file.name}: ${matches.length} hit(s)`,
      ).output;
    } catch (error) {
      return this.fail(error);
    }
  }
}
