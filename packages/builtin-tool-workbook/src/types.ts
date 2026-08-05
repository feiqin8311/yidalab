export const WorkbookIdentifier = 'lobe-workbook';

export const WorkbookApiName = {
  inspectWorkbook: 'inspectWorkbook',
  previewSheet: 'previewSheet',
  querySheet: 'querySheet',
} as const;

export type WorkbookApiNameType = (typeof WorkbookApiName)[keyof typeof WorkbookApiName];

export interface InspectWorkbookParams {
  fileId: string;
}

export interface PreviewSheetParams {
  fileId: string;
  limit?: number;
  sheet: string;
}

export interface QuerySheetFilter {
  column: string;
  op?: 'eq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';
  value: string | number | boolean | null;
}

export interface QuerySheetAggregate {
  column: string;
  op: 'sum' | 'avg' | 'min' | 'max' | 'count';
}

export interface QuerySheetParams {
  aggregates?: QuerySheetAggregate[];
  columns?: string[];
  cursor?: string;
  fileId: string;
  filters?: QuerySheetFilter[];
  groupBy?: string[];
  limit?: number;
  orderBy?: { column: string; direction?: 'asc' | 'desc' }[];
  sheet: string;
}
