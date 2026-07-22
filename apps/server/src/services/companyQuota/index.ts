import { ChatErrorType } from '@lobechat/types';

import {
  CompanyMemberQuotaModel,
  isModelAllowed,
  type MemberQuotaSnapshot,
  resolveEffectiveMonthlyLimit,
} from '@/database/models/companyMemberQuota';
import type { AllowedModelRef } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

export type CompanyQuotaDenyReason = 'model_not_allowed' | 'quota_exceeded';

export class CompanyQuotaDeniedError extends Error {
  readonly errorType:
    typeof ChatErrorType.Forbidden | typeof ChatErrorType.InsufficientBudgetForModel;
  readonly reason: CompanyQuotaDenyReason;
  readonly detail: Record<string, unknown>;

  constructor(reason: CompanyQuotaDenyReason, detail: Record<string, unknown> = {}) {
    super(reason === 'quota_exceeded' ? 'QUOTA_EXCEEDED' : 'MODEL_NOT_ALLOWED');
    this.name = 'CompanyQuotaDeniedError';
    this.reason = reason;
    this.detail = detail;
    this.errorType =
      reason === 'quota_exceeded'
        ? ChatErrorType.InsufficientBudgetForModel
        : ChatErrorType.Forbidden;
  }
}

/**
 * Enforce per-member monthly spend cap + model allowlist for company workspaces.
 * Users outside a company are unrestricted.
 *
 * Default (no policy row): 500k credits / 30-day cycle. Admin can raise,
 * unlimited, or lock models via company_member_quotas.
 */
export class CompanyQuotaService {
  private readonly model: CompanyMemberQuotaModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {
    this.model = new CompanyMemberQuotaModel(db, userId);
  }

  getSnapshot = async (userId = this.userId): Promise<MemberQuotaSnapshot | null> => {
    const workspaceId = await this.model.getCompanyWorkspaceId(userId);
    if (!workspaceId) return null;

    const policy = await this.model.getQuota(workspaceId, userId);
    const monthSpend = await this.model.getMonthSpend(userId);
    const effective = resolveEffectiveMonthlyLimit(policy);
    const remainingCost =
      effective.unlimited || effective.monthlyLimitCost === null
        ? null
        : Math.max(0, effective.monthlyLimitCost - monthSpend);

    return {
      allowedModels: policy?.allowedModels ?? null,
      isDefault: effective.isDefault,
      monthSpend,
      monthlyLimitCost: effective.monthlyLimitCost,
      remainingCost,
      unlimited: effective.unlimited,
      userId,
      workspaceId,
    };
  };

  listMemberSnapshots = async (workspaceId: string): Promise<MemberQuotaSnapshot[]> => {
    const quotas = await this.model.listQuotas(workspaceId);
    const snapshots: MemberQuotaSnapshot[] = [];
    for (const policy of quotas) {
      const monthSpend = await this.model.getMonthSpend(policy.userId);
      const effective = resolveEffectiveMonthlyLimit(policy);
      snapshots.push({
        allowedModels: policy.allowedModels,
        isDefault: effective.isDefault,
        monthSpend,
        monthlyLimitCost: effective.monthlyLimitCost,
        remainingCost:
          effective.unlimited || effective.monthlyLimitCost === null
            ? null
            : Math.max(0, effective.monthlyLimitCost - monthSpend),
        unlimited: effective.unlimited,
        userId: policy.userId,
        workspaceId: policy.workspaceId,
      });
    }
    return snapshots;
  };

  getMonthSpend = (userId: string) => this.model.getMonthSpend(userId);

  upsertMemberQuota = async (input: {
    allowedModels: AllowedModelRef[] | null;
    monthlyLimitCost: number | null;
    userId: string;
    workspaceId: string;
  }) => {
    return this.model.upsert({
      ...input,
      updatedBy: this.userId,
    });
  };

  clearMemberQuota = async (workspaceId: string, userId: string) => {
    // Delete custom row → fall back to default 500k credits / month.
    await this.model.clear(workspaceId, userId);
  };

  /**
   * Hard-check before any LLM call. No-op when user is not in a company.
   * Quota is always keyed by the user's company membership (not chat workspace).
   */
  assertCanUseModel = async (input: {
    model: string;
    provider: string;
    userId?: string;
  }): Promise<void> => {
    const userId = input.userId ?? this.userId;
    const workspaceId = await this.model.getCompanyWorkspaceId(userId);

    if (!workspaceId) return;

    const policy = await this.model.getQuota(workspaceId, userId);

    if (!isModelAllowed(policy?.allowedModels, input.provider, input.model)) {
      throw new CompanyQuotaDeniedError('model_not_allowed', {
        allowedModels: policy?.allowedModels ?? [],
        model: input.model,
        provider: input.provider,
      });
    }

    const effective = resolveEffectiveMonthlyLimit(policy);
    if (effective.unlimited || effective.monthlyLimitCost === null) return;

    const monthSpend = await this.model.getMonthSpend(userId);
    if (monthSpend >= effective.monthlyLimitCost) {
      throw new CompanyQuotaDeniedError('quota_exceeded', {
        limit: effective.monthlyLimitCost,
        model: input.model,
        monthSpend,
        provider: input.provider,
      });
    }
  };
}
