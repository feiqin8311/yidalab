'use client';

import { WORKSPACES_KEY } from '@/business/client/hooks/useWorkspaces';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { companyService } from '@/services/company';

export const COMPANY_MINE_KEY = 'company/mine';
const departmentsKey = (workspaceId: string) => ['company/departments', workspaceId] as const;
const invitationsKey = (workspaceId: string) => ['company/invitations', workspaceId] as const;
const membersKey = (workspaceId: string) => ['company/members', workspaceId] as const;

export const useMyCompany = () =>
  useClientDataSWR(COMPANY_MINE_KEY, () => companyService.getMine());

export const useCompanyDepartments = (workspaceId?: string) =>
  useClientDataSWR(workspaceId ? departmentsKey(workspaceId) : null, () =>
    companyService.listDepartments(workspaceId!),
  );

export const useCompanyInvitations = (workspaceId?: string) =>
  useClientDataSWR(workspaceId ? invitationsKey(workspaceId) : null, () =>
    companyService.listInvitations(workspaceId!),
  );

export const useCompanyMembers = (workspaceId?: string) =>
  useClientDataSWR(workspaceId ? membersKey(workspaceId) : null, () =>
    companyService.listMembers(workspaceId!),
  );

export const refreshCompany = async (workspaceId?: string) => {
  await Promise.all([
    mutate(COMPANY_MINE_KEY),
    // Keep sidebar / URL workspace list in sync after create/leave/rename.
    mutate(WORKSPACES_KEY),
    ...(workspaceId
      ? [
          mutate(departmentsKey(workspaceId)),
          mutate(invitationsKey(workspaceId)),
          mutate(membersKey(workspaceId)),
        ]
      : []),
  ]);
};
