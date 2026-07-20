import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';
import { trpc } from '@/libs/trpc/lambda/init';

const mocks = vi.hoisted(() => ({
  getMyCompany: vi.fn(),
  getServerDB: vi.fn(async () => ({})),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mocks.getServerDB,
}));

vi.mock('@/database/models/company', () => ({
  CompanyModel: vi.fn(() => ({
    getMyCompany: mocks.getMyCompany,
  })),
}));

const { wsCompatProcedure } = await import('@/business/server/trpc-middlewares/workspaceAuth');

const appRouter = trpc.router({
  currentWorkspace: wsCompatProcedure.query(({ ctx }) => ctx.workspaceId),
});

const createCaller = createCallerFactory(appRouter);

describe('company workspace auth', () => {
  it('requires the signed-in user to belong to a company', async () => {
    mocks.getMyCompany.mockResolvedValue(null);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.currentWorkspace()).rejects.toEqual(
      new TRPCError({ code: 'FORBIDDEN', message: 'COMPANY_REQUIRED' }),
    );
  });

  it('uses the current company workspace instead of the client supplied workspace id', async () => {
    mocks.getMyCompany.mockResolvedValue({
      id: 'company-workspace',
      name: 'YidaLab',
      role: 'owner',
      slug: 'company-yida',
    });

    const caller = createCaller(
      await createContextInner({ userId: 'user-1', workspaceId: 'client-workspace' }),
    );

    await expect(caller.currentWorkspace()).resolves.toBe('company-workspace');
  });
});
