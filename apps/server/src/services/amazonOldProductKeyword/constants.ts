import {
  DATA_SOURCE_ROLES,
  type DataSourceRole,
  DEFAULT_THRESHOLDS,
  FUNCTION_ID,
} from '@lobechat/utils';

export { DATA_SOURCE_ROLES, DEFAULT_THRESHOLDS, FUNCTION_ID };

export const RUN_S3_PREFIX = (workspaceId: string, runId: string) =>
  `business-functions/${FUNCTION_ID}/${workspaceId}/${runId}`;

export const INPUT_S3_KEY = (
  workspaceId: string,
  runId: string,
  role: DataSourceRole,
  fileName: string,
) => {
  const safe = fileName.replaceAll(/[/\\]/g, '_');
  return `${RUN_S3_PREFIX(workspaceId, runId)}/inputs/${role}/${safe}`;
};

export const EXPORT_S3_KEY = (workspaceId: string, runId: string, fileName: string) =>
  `${RUN_S3_PREFIX(workspaceId, runId)}/exports/${fileName}`;

export const MAX_INPUT_FILE_BYTES = 80 * 1024 * 1024; // 80MB per file
export const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv', '.html', '.htm']);
export const AI_BATCH_SIZE = 40;
export const AI_MAX_RETRIES = 2;

export const ROLE_ALLOWED_EXTENSIONS: Record<string, Set<string>> = {
  product_html: new Set(['.html', '.htm']),
  historical_terms: new Set(['.xlsx', '.xls', '.csv']),
  sp_search_terms_daily: new Set(['.xlsx', '.xls', '.csv']),
  sp_targeting: new Set(['.xlsx', '.xls', '.csv']),
  sp_impression_share: new Set(['.xlsx', '.xls', '.csv']),
  sb_search_terms_daily: new Set(['.xlsx', '.xls', '.csv']),
  multi_asin: new Set(['.xlsx', '.xls', '.csv']),
};

export const ROLE_ALLOWED_MIME: Record<string, Set<string>> = {
  product_html: new Set([
    'text/html',
    'application/xhtml+xml',
    'text/plain',
    'application/octet-stream',
  ]),
  historical_terms: new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv',
    'text/plain',
    'application/octet-stream',
  ]),
  sp_search_terms_daily: new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv',
    'application/octet-stream',
  ]),
  sp_targeting: new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/octet-stream',
  ]),
  sp_impression_share: new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/octet-stream',
  ]),
  sb_search_terms_daily: new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/octet-stream',
  ]),
  multi_asin: new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/octet-stream',
  ]),
};

export const assertRoleFile = (role: string, fileName: string, contentType?: string) => {
  const ext = fileName.includes('.') ? `.${fileName.split('.').pop()!.toLowerCase()}` : '';
  const allowedExt = ROLE_ALLOWED_EXTENSIONS[role] ?? ALLOWED_EXTENSIONS;
  if (!allowedExt.has(ext)) {
    throw new Error(`INVALID_ROLE_EXTENSION:${role}:${ext}`);
  }
  if (contentType) {
    const base = contentType.split(';')[0]!.trim().toLowerCase();
    const allowedMime = ROLE_ALLOWED_MIME[role];
    if (allowedMime && !allowedMime.has(base)) {
      throw new Error(`INVALID_ROLE_MIME:${role}:${base}`);
    }
  }
  return ext;
};

export const ROLE_HINTS: Record<DataSourceRole, RegExp[]> = {
  product_html: [/产品调研/, /product.?research/i, /\.html?$/i],
  historical_terms: [/历史出单/, /领星/, /historical/i, /出单词/],
  sp_search_terms_daily: [
    /SP.*搜索词/,
    /搜索词.*SP/,
    /sponsored.?products?.?search/i,
    /商品推广.*搜索/,
  ],
  sp_targeting: [/SP.*投放/, /投放.*报告/, /targeting/i, /商品推广.*投放/],
  sp_impression_share: [/展示量份额/, /impression.?share/i, /份额/],
  sb_search_terms_daily: [/SB.*搜索词/, /品牌推广.*搜索/, /sponsored.?brands?.?search/i, /SBV|SBH/],
  multi_asin: [/多ASIN/, /反查/, /对比报告/, /multi.?asin/i, /竞品/],
};

export const guessRoleFromFileName = (fileName: string): DataSourceRole | null => {
  for (const role of DATA_SOURCE_ROLES) {
    if (ROLE_HINTS[role].some((re) => re.test(fileName))) return role;
  }
  if (/\.html?$/i.test(fileName)) return 'product_html';
  return null;
};
