import { lambdaClient } from '@/libs/trpc/client';

class CompanyMarketSkillService {
  delete = async (identifier: string) => lambdaClient.market.skill.delete.mutate({ identifier });

  publish = async (params: { identifier?: string; zipFileId: string }) =>
    lambdaClient.market.skill.publish.mutate(params);

  updateSkillVisibility = async (params: { hideContent: boolean; identifier: string }) =>
    lambdaClient.market.skill.updateSkillVisibility.mutate(params);
}

export const companyMarketSkillService = new CompanyMarketSkillService();
