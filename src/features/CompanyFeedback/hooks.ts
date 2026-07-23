'use client';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { companyFeedbackService, type CompanyFeedbackStatus } from '@/services/companyFeedback';

export const companyFeedbackListKey = (
  workspaceId: string | undefined,
  status?: CompanyFeedbackStatus | 'all',
) => (workspaceId ? (['companyFeedback/list', workspaceId, status ?? 'all'] as const) : null);

export const useCompanyFeedbackList = (
  workspaceId: string | undefined,
  status?: CompanyFeedbackStatus | 'all',
) =>
  useClientDataSWR(companyFeedbackListKey(workspaceId, status), () =>
    companyFeedbackService.list({
      workspaceId: workspaceId!,
      ...(status && status !== 'all' ? { status } : {}),
    }),
  );

export const refreshCompanyFeedbackList = async (workspaceId?: string) => {
  if (!workspaceId) return;
  await mutate(
    (key) => Array.isArray(key) && key[0] === 'companyFeedback/list' && key[1] === workspaceId,
  );
};
