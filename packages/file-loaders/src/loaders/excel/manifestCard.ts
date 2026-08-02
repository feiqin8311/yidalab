import type { WorkbookAssetBuild } from './workbookAsset';
import { WORKBOOK_CARD_SAMPLE_ROWS } from './workbookAsset';

/** Soft token budgets for attachment cards in the model prompt. */
export const FILE_CARD_MAX_CHARS = 12_000;
export const ALL_FILE_CARDS_MAX_CHARS = 48_000;
export const INLINE_FILE_TOKEN_LIMIT = 6_000;

const approxTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Build a bounded text card for a workbook (never the full grid).
 */
export function buildWorkbookManifestCard(
  build: WorkbookAssetBuild,
  meta: { fileId: string; fileName: string; size: number },
): string {
  const coverage = 'coverage' in build ? build.coverage : undefined;
  const lines: string[] = [
    `Workbook fileId=${meta.fileId} name="${meta.fileName}" size=${meta.size}`,
    `parser=${build.parserVersion} sheets=${build.sheetCount} totalRows=${build.totalRows}`,
    `unrestrictedTokenEstimate≈${build.unrestrictedTokenEstimate}`,
    `Full data is NOT inlined. Use lobe-workbook inspectWorkbook / previewSheet / querySheet.`,
  ];
  if (coverage && (coverage.sheetsCapped || coverage.columnsCapped)) {
    lines.push(
      `coverageLimited: sheetsCapped=${Boolean(coverage.sheetsCapped)} (sourceSheets=${coverage.sourceSheetCount}) columnsCapped=${Boolean(coverage.columnsCapped)}`,
    );
  }

  let used = lines.join('\n').length;
  for (const sheet of build.sheets) {
    const header = [
      ``,
      `## sheet "${sheet.sheetName}" (index=${sheet.sheetIndex}) rows=${sheet.rowCount} cols=${sheet.columnCount}`,
      `columns: ${sheet.columns.slice(0, 40).join(' | ')}${sheet.columns.length > 40 ? ' …' : ''}`,
    ];
    const samples = sheet.sampleRows
      .slice(0, WORKBOOK_CARD_SAMPLE_ROWS)
      .map((r, i) => `  sample[${i}]: ${JSON.stringify(r).slice(0, 400)}`);
    const block = [...header, ...samples].join('\n');
    if (used + block.length > FILE_CARD_MAX_CHARS) {
      lines.push(
        ``,
        `…remaining sheets omitted from card (use inspectWorkbook). total sheets=${build.sheetCount}`,
      );
      break;
    }
    lines.push(block);
    used += block.length;
  }

  return lines.join('\n').slice(0, FILE_CARD_MAX_CHARS);
}

export function shouldInlineParsedText(params: {
  columnCount?: number;
  content: string;
  rowCount?: number;
  size: number;
}): boolean {
  const tokens = approxTokens(params.content);
  if (tokens > INLINE_FILE_TOKEN_LIMIT) return false;
  if (params.size > 200_000) return false;
  if ((params.rowCount ?? 0) > 500) return false;
  if ((params.columnCount ?? 0) > 40) return false;
  return true;
}

export { approxTokens };
