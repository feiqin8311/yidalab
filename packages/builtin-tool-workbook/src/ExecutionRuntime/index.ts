import { createHash } from 'node:crypto';

import type { BuiltinServerRuntimeOutput, ToolExecutionResult } from '@lobechat/types';
import { EXTERNAL_TRUST } from '@lobechat/types';

import type { InspectWorkbookParams, PreviewSheetParams, QuerySheetParams } from '../types';

export interface WorkbookServiceBridge {
  inspectWorkbook: (fileId: string) => Promise<unknown>;
  previewSheet: (fileId: string, sheet: string, limit?: number) => Promise<unknown>;
  querySheet: (args: QuerySheetParams) => Promise<unknown>;
}

const MODEL_MAX = 40_000;

const queryHashOf = (args: object) =>
  createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 16);

export class WorkbookExecutionRuntime {
  constructor(private readonly service: WorkbookServiceBridge) {}

  private toOutput(result: ToolExecutionResult): BuiltinServerRuntimeOutput {
    return {
      content: result.modelView.content,
      error: result.error,
      executionResult: result,
      state: result.uiView,
      success: result.success,
    };
  }

  private fail(error: unknown): BuiltinServerRuntimeOutput {
    const message = error instanceof Error ? error.message : String(error);
    const executionResult: ToolExecutionResult = {
      content: message,
      error: { message, type: 'PluginServerError' },
      modelView: {
        content: message,
        trust: EXTERNAL_TRUST,
      },
      success: false,
      telemetryView: {
        preview: message.slice(0, 512),
        success: false,
        errorCode: 'PluginServerError',
      },
      uiView: { summary: message, truncated: false },
    };
    return this.toOutput(executionResult);
  }

  private successFromQuery(
    data: Record<string, unknown>,
    source: { fileId: string; sheet?: string; queryHash?: string; fileVersion?: string },
    uiSummary: string,
  ): BuiltinServerRuntimeOutput {
    const coverage = {
      matchedRows: data.matchedRows as number | undefined,
      returnedRows: Number(data.returnedRows ?? (data.rows as unknown[] | undefined)?.length ?? 0),
      scannedRows: data.scannedRows as number | undefined,
      totalRows: data.totalRows as number | undefined,
    };
    const payload = {
      ...data,
      coverage: {
        ...coverage,
        coverageLimited: data.coverageLimited,
      },
      source: { ...source, tool: 'lobe-workbook' },
      trust: EXTERNAL_TRUST,
    };
    let content = JSON.stringify(payload);
    let truncated = Boolean(data.truncated);
    if (content.length > MODEL_MAX) {
      // Keep valid JSON: drop row payloads first, then hard-cap fields.
      const rows = Array.isArray(data.rows) ? (data.rows as unknown[]) : [];
      let slimRows = rows;
      while (slimRows.length > 0 && content.length > MODEL_MAX) {
        slimRows = slimRows.slice(0, -1);
        content = JSON.stringify({
          ...payload,
          rows: slimRows,
          returnedRows: slimRows.length,
          truncated: true,
        });
      }
      if (content.length > MODEL_MAX) {
        content = JSON.stringify({
          coverage: payload.coverage,
          nextCursor: data.nextCursor,
          returnedRows: 0,
          rows: [],
          source: payload.source,
          truncated: true,
          trust: EXTERNAL_TRUST,
          warning: 'modelView truncated to stay under size cap; use nextCursor / smaller limit',
        });
      }
      truncated = true;
    }
    const executionResult: ToolExecutionResult = {
      content,
      modelView: {
        content,
        coverage,
        nextCursor: data.nextCursor as string | undefined,
        source: { ...source, tool: 'lobe-workbook' },
        truncated,
        trust: EXTERNAL_TRUST,
      },
      success: true,
      telemetryView: {
        preview: content.slice(0, 1024),
        success: true,
      },
      uiView: {
        nextCursor: data.nextCursor as string | undefined,
        preview: Array.isArray(data.rows) ? (data.rows as unknown[]).slice(0, 5) : undefined,
        summary: uiSummary,
        truncated,
      },
    };
    return this.toOutput(executionResult);
  }

  async inspectWorkbook(args: InspectWorkbookParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = (await this.service.inspectWorkbook(args.fileId)) as Record<string, unknown>;
      const card = String(data.promptCard ?? JSON.stringify(data));
      const content = card.length > MODEL_MAX ? `${card.slice(0, MODEL_MAX)}\n…[truncated]` : card;
      const executionResult: ToolExecutionResult = {
        content,
        modelView: {
          content,
          source: {
            fileId: args.fileId,
            fileVersion: data.fileVersion as string | undefined,
            tool: 'lobe-workbook.inspectWorkbook',
          },
          truncated: card.length > MODEL_MAX,
          trust: EXTERNAL_TRUST,
        },
        success: true,
        telemetryView: { preview: content.slice(0, 512), success: true },
        uiView: {
          summary: `Workbook ${args.fileId} ready`,
          truncated: card.length > MODEL_MAX,
        },
      };
      return this.toOutput(executionResult);
    } catch (error) {
      return this.fail(error);
    }
  }

  async previewSheet(args: PreviewSheetParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = (await this.service.previewSheet(args.fileId, args.sheet, args.limit)) as Record<
        string,
        unknown
      >;
      return this.successFromQuery(
        data,
        {
          fileId: args.fileId,
          fileVersion: (data.source as { fileVersion?: string } | undefined)?.fileVersion,
          queryHash: queryHashOf(args),
          sheet: args.sheet,
        },
        `preview ${args.sheet}: ${data.returnedRows ?? 0} rows`,
      );
    } catch (error) {
      return this.fail(error);
    }
  }

  async querySheet(args: QuerySheetParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = (await this.service.querySheet(args)) as Record<string, unknown>;
      return this.successFromQuery(
        data,
        {
          fileId: args.fileId,
          fileVersion: (data.source as { fileVersion?: string } | undefined)?.fileVersion,
          queryHash: queryHashOf(args),
          sheet: args.sheet,
        },
        `query ${args.sheet}: returned ${data.returnedRows ?? 0}/${data.totalRows ?? '?'}`,
      );
    } catch (error) {
      return this.fail(error);
    }
  }
}
