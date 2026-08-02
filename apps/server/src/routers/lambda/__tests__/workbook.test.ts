import { WorkbookExecutionRuntime } from '@lobechat/builtin-tool-workbook/executionRuntime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workbookRouter } from '@/server/routers/lambda/workbook';

const mockInspect = vi.fn();
const mockPreview = vi.fn();
const mockQuery = vi.fn();

const routerMocks = vi.hoisted(() => {
  const chain = (): any => {
    const result = Promise.resolve([{ role: 'member' }]);
    const api: any = {};
    api.from = vi.fn(() => api);
    api.innerJoin = vi.fn(() => api);
    api.leftJoin = vi.fn(() => api);
    api.where = vi.fn(() => result);
    api.limit = vi.fn(() => result);
    return api;
  };

  return {
    getMyCompany: vi.fn().mockResolvedValue({ id: 'default-company' }),
    serverDB: {
      select: vi.fn(() => chain()),
      query: {
        workspaces: { findFirst: vi.fn() },
      },
    },
  };
});

vi.mock('@/database/models/company', () => ({
  CompanyModel: vi.fn(() => ({
    getMyCompany: routerMocks.getMyCompany,
  })),
}));

vi.mock('@/server/services/toolExecution/serverRuntimes/workbook', () => ({
  workbookRuntime: {
    factory: () =>
      new WorkbookExecutionRuntime({
        inspectWorkbook: mockInspect,
        previewSheet: mockPreview,
        querySheet: mockQuery,
      }),
    identifier: 'lobe-workbook',
  },
}));

describe('workbookRouter.execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInspect.mockResolvedValue({ promptCard: 'sheet card', fileVersion: 'v1' });
  });

  const caller = () =>
    workbookRouter.createCaller({
      serverDB: routerMocks.serverDB,
      userId: 'user-1',
      jwtPayload: { userId: 'user-1' },
    } as any);

  it('inspectWorkbook succeeds with class runtime this binding', async () => {
    const result = await caller().execute({
      apiName: 'inspectWorkbook',
      args: { fileId: 'file-1' },
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('sheet card');
    expect(mockInspect).toHaveBeenCalledWith('file-1');
  });

  it('maps service errors via fail without this-binding crash', async () => {
    mockInspect.mockRejectedValue(new Error('not ready'));

    const result = await caller().execute({
      apiName: 'inspectWorkbook',
      args: { fileId: 'file-1' },
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('not ready');
    expect(String(result.content)).not.toMatch(/reading 'fail'/);
  });
});

describe('WorkbookExecutionRuntime this-binding', () => {
  it('detached method without rebind throws reading fail (documents the bug)', async () => {
    const runtime = new WorkbookExecutionRuntime({
      inspectWorkbook: vi.fn().mockRejectedValue(new Error('parse failed')),
      previewSheet: vi.fn(),
      querySheet: vi.fn(),
    });
    const fn = runtime.inspectWorkbook;
    await expect(fn({ fileId: 'f1' })).rejects.toThrow(
      /reading 'fail'|Cannot read properties of undefined/,
    );
  });

  it('fn.call(runtime) rebinds this so fail() works', async () => {
    const runtime = new WorkbookExecutionRuntime({
      inspectWorkbook: vi.fn().mockRejectedValue(new Error('parse failed')),
      previewSheet: vi.fn(),
      querySheet: vi.fn(),
    });
    const fn = runtime.inspectWorkbook;
    const result = await fn.call(runtime, { fileId: 'f1' });
    expect(result.success).toBe(false);
    expect(result.content).toContain('parse failed');
  });
});
