import { lambdaClient } from '@/libs/trpc/client';

class CompanyService {
  acceptInvitation = async (token: string) =>
    (await lambdaClient.company.acceptInvitation.mutate({ token })).data;

  create = async (params: { departmentName: string; name: string; position: string }) =>
    (await lambdaClient.company.create.mutate(params)).data;

  createDepartment = async (params: { name: string; workspaceId: string }) =>
    (await lambdaClient.company.createDepartment.mutate(params)).data;

  delete = async (workspaceId: string) => lambdaClient.company.delete.mutate({ workspaceId });

  deleteDepartment = async (params: { departmentId: string; workspaceId: string }) =>
    lambdaClient.company.deleteDepartment.mutate(params);

  getInvitation = async (token: string) =>
    (await lambdaClient.company.getInvitation.query({ token })).data;

  getMine = async () => (await lambdaClient.company.getMine.query()).data;

  leave = async (workspaceId: string) => lambdaClient.company.leave.mutate({ workspaceId });

  listDepartments = async (workspaceId: string) =>
    (await lambdaClient.company.listDepartments.query({ workspaceId })).data;

  listInvitations = async (workspaceId: string) =>
    (await lambdaClient.company.listInvitations.query({ workspaceId })).data;

  listMembers = async (workspaceId: string) =>
    (await lambdaClient.company.listMembers.query({ workspaceId })).data;

  listMine = async () => (await lambdaClient.company.listMine.query()).data;

  removeMember = async (params: { userId: string; workspaceId: string }) =>
    lambdaClient.company.removeMember.mutate(params);

  resendInvitation = async (params: { invitationId: string; workspaceId: string }) =>
    lambdaClient.company.resendInvitation.mutate(params);

  revokeInvitation = async (params: { invitationId: string; workspaceId: string }) =>
    lambdaClient.company.revokeInvitation.mutate(params);

  sendInvitation = async (params: {
    departmentId: string;
    email: string;
    position: string;
    role: 'admin' | 'member';
    workspaceId: string;
  }) => (await lambdaClient.company.sendInvitation.mutate(params)).data;

  transferOwnership = async (params: { userId: string; workspaceId: string }) =>
    (await lambdaClient.company.transferOwnership.mutate(params)).data;

  updateCompany = async (params: { name: string; workspaceId: string }) =>
    (await lambdaClient.company.updateCompany.mutate(params)).data;

  updateDepartment = async (params: { departmentId: string; name: string; workspaceId: string }) =>
    (await lambdaClient.company.updateDepartment.mutate(params)).data;

  updateMember = async (params: {
    departmentId: string;
    position: string;
    role: 'admin' | 'member';
    userId: string;
    workspaceId: string;
  }) => (await lambdaClient.company.updateMember.mutate(params)).data;

  getMyQuota = async () => (await lambdaClient.company.getMyQuota.query()).data;

  listMemberQuotas = async (workspaceId: string) =>
    (await lambdaClient.company.listMemberQuotas.query({ workspaceId })).data;

  upsertMemberQuota = async (params: {
    allowedModels: Array<{ model: string; provider: string }> | null;
    monthlyLimitCost: number | null;
    userId: string;
    workspaceId: string;
  }) => (await lambdaClient.company.upsertMemberQuota.mutate(params)).data;

  clearMemberQuota = async (params: { userId: string; workspaceId: string }) =>
    lambdaClient.company.clearMemberQuota.mutate(params);
}

export const companyService = new CompanyService();
