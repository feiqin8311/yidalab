import { lambdaClient } from '@/libs/trpc/client';

export type LingxingAnalyzeParams = {
  campaignName: string;
  country: string;
  model: { model: string; provider: string };
  sku: string;
  workspaceId: string;
};

export type AmazonKwCreateDraftParams = {
  workspaceId: string;
  mainAsin: string;
  categoryName: string;
  priceUsd: number;
  model: { provider: string; model: string };
  thresholds?: {
    targetAcos?: number;
    highRiskAcos?: number;
    wasteSpendRatioToPrice?: number;
    wasteClicks?: number;
    highRelevanceScore?: number;
    coreRelevanceScore?: number;
  };
};

class BusinessFunctionService {
  lingxingAdsAnalyze = async (params: LingxingAnalyzeParams) =>
    (await lambdaClient.businessFunction.lingxingAds.analyze.mutate(params)).data;

  amazonKw = {
    createDraft: async (params: AmazonKwCreateDraftParams) =>
      (await lambdaClient.businessFunction.amazonOldProductKeyword.createDraft.mutate(params)).data,

    createUploadUrl: async (params: {
      workspaceId: string;
      runId: string;
      role: string;
      fileName: string;
      contentType?: string;
    }) =>
      (
        await lambdaClient.businessFunction.amazonOldProductKeyword.createUploadUrl.mutate(
          params as any,
        )
      ).data,

    confirmUpload: async (params: {
      workspaceId: string;
      runId: string;
      role: string;
      fileName: string;
      s3Key: string;
    }) =>
      (
        await lambdaClient.businessFunction.amazonOldProductKeyword.confirmUpload.mutate(
          params as any,
        )
      ).data,

    guessRoles: async (params: { workspaceId: string; fileNames: string[] }) =>
      (await lambdaClient.businessFunction.amazonOldProductKeyword.guessRoles.mutate(params)).data,

    auditInputs: async (params: { workspaceId: string; runId: string }) =>
      (await lambdaClient.businessFunction.amazonOldProductKeyword.auditInputs.mutate(params)).data,

    start: async (params: { workspaceId: string; runId: string }) =>
      (await lambdaClient.businessFunction.amazonOldProductKeyword.start.mutate(params)).data,

    listRuns: async (params: { workspaceId: string; limit?: number; offset?: number }) =>
      (await lambdaClient.businessFunction.amazonOldProductKeyword.listRuns.query(params)).data,

    getRun: async (params: { workspaceId: string; runId: string }) =>
      (await lambdaClient.businessFunction.amazonOldProductKeyword.getRun.query(params)).data,

    listResultRows: async (params: {
      workspaceId: string;
      runId: string;
      viewId: string;
      search?: string;
      limit?: number;
      offset?: number;
      sortBy?: 'orders' | 'spend' | 'score' | 'rank' | 'createdAt';
      sortDir?: 'asc' | 'desc';
    }) =>
      (await lambdaClient.businessFunction.amazonOldProductKeyword.listResultRows.query(params))
        .data,

    cancel: async (params: { workspaceId: string; runId: string }) =>
      (await lambdaClient.businessFunction.amazonOldProductKeyword.cancel.mutate(params)).data,

    retry: async (params: { workspaceId: string; runId: string }) =>
      (await lambdaClient.businessFunction.amazonOldProductKeyword.retry.mutate(params)).data,

    delete: async (params: { workspaceId: string; runId: string }) =>
      (await lambdaClient.businessFunction.amazonOldProductKeyword.delete.mutate(params)).data,

    requestExport: async (params: { workspaceId: string; runId: string }) =>
      (await lambdaClient.businessFunction.amazonOldProductKeyword.requestExport.mutate(params))
        .data,

    getExportUrl: async (params: { workspaceId: string; runId: string }) =>
      (await lambdaClient.businessFunction.amazonOldProductKeyword.getExportUrl.query(params)).data,
  };
}

export const businessFunctionService = new BusinessFunctionService();
export default businessFunctionService;
