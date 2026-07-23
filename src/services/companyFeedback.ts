import { lambdaClient } from '@/libs/trpc/client';

export type CompanyFeedbackStatus = 'pending' | 'accepted' | 'declined';

class CompanyFeedbackService {
  list = async (params: { status?: CompanyFeedbackStatus; workspaceId: string }) =>
    (await lambdaClient.companyFeedback.list.query(params)).data;

  create = async (params: { content: string; title: string; workspaceId: string }) =>
    (await lambdaClient.companyFeedback.create.mutate(params)).data;

  update = async (params: { content?: string; id: string; title?: string }) =>
    (await lambdaClient.companyFeedback.update.mutate(params)).data;

  updateStatus = async (params: { id: string; status: CompanyFeedbackStatus }) =>
    (await lambdaClient.companyFeedback.updateStatus.mutate(params)).data;

  delete = async (id: string) => lambdaClient.companyFeedback.delete.mutate({ id });
}

export const companyFeedbackService = new CompanyFeedbackService();
