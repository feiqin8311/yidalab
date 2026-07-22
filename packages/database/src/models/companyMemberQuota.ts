import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';

import { type AllowedModelRef, companyMemberQuotas, messages, workspaceMembers } from '../schemas';
import type { LobeChatDatabase } from '../type';

/**
 * Default monthly credit budget for company members without a custom policy row.
 * Heavy users / admins can be raised or set unlimited via admin UI.
 */
export const DEFAULT_MEMBER_MONTHLY_CREDITS = 500_000;

/** USD equivalent of {@link DEFAULT_MEMBER_MONTHLY_CREDITS} (1 USD = 1e6 credits). */
export const DEFAULT_MEMBER_MONTHLY_LIMIT_COST =
  DEFAULT_MEMBER_MONTHLY_CREDITS / CREDITS_PER_DOLLAR;

/** Quota window length: fixed 30-day cycles (not calendar months). */
export const QUOTA_CYCLE_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const QUOTA_CYCLE_MS = QUOTA_CYCLE_DAYS * MS_PER_DAY;

/**
 * Current 30-day quota cycle bounds, aligned to UTC Unix epoch.
 * Same window for every company member so reset time is shared and predictable.
 */
export const getQuotaCycleBounds = (now: Date = new Date()): { end: Date; start: Date } => {
  const t = now.getTime();
  const startMs = Math.floor(t / QUOTA_CYCLE_MS) * QUOTA_CYCLE_MS;
  return {
    end: new Date(startMs + QUOTA_CYCLE_MS),
    start: new Date(startMs),
  };
};

export interface MemberQuotaPolicy {
  allowedModels: AllowedModelRef[] | null;
  monthlyLimitCost: number | null;
  userId: string;
  workspaceId: string;
}

export interface MemberQuotaSnapshot extends MemberQuotaPolicy {
  /** True when no custom policy row exists (using company default budget). */
  isDefault?: boolean;
  monthSpend: number;
  remainingCost: number | null;
  unlimited: boolean;
}

/**
 * Resolve the effective monthly USD cap.
 *
 * - No policy row → default 500k credits / month (not unlimited).
 * - Row with `monthlyLimitCost: null` → admin set unlimited.
 * - Row with a number → that cap.
 */
export const resolveEffectiveMonthlyLimit = (
  policy: Pick<MemberQuotaPolicy, 'monthlyLimitCost'> | null | undefined,
): { isDefault: boolean; monthlyLimitCost: number | null; unlimited: boolean } => {
  if (!policy) {
    return {
      isDefault: true,
      monthlyLimitCost: DEFAULT_MEMBER_MONTHLY_LIMIT_COST,
      unlimited: false,
    };
  }
  if (policy.monthlyLimitCost === null) {
    return { isDefault: false, monthlyLimitCost: null, unlimited: true };
  }
  return {
    isDefault: false,
    monthlyLimitCost: policy.monthlyLimitCost,
    unlimited: false,
  };
};

export class CompanyMemberQuotaModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  /**
   * Resolve the company workspace for a user (YidaLab: one company membership).
   * Returns null when the user is not in a company.
   */
  getCompanyWorkspaceId = async (userId = this.userId): Promise<string | null> => {
    const [row] = await this.db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, userId), isNull(workspaceMembers.deletedAt)))
      .limit(1);
    return row?.workspaceId ?? null;
  };

  getQuota = async (workspaceId: string, userId: string): Promise<MemberQuotaPolicy | null> => {
    const [row] = await this.db
      .select({
        allowedModels: companyMemberQuotas.allowedModels,
        monthlyLimitCost: companyMemberQuotas.monthlyLimitCost,
        userId: companyMemberQuotas.userId,
        workspaceId: companyMemberQuotas.workspaceId,
      })
      .from(companyMemberQuotas)
      .where(
        and(
          eq(companyMemberQuotas.workspaceId, workspaceId),
          eq(companyMemberQuotas.userId, userId),
        ),
      )
      .limit(1);

    if (!row) return null;
    return {
      allowedModels: row.allowedModels ?? null,
      monthlyLimitCost:
        row.monthlyLimitCost === null || row.monthlyLimitCost === undefined
          ? null
          : Number(row.monthlyLimitCost),
      userId: row.userId,
      workspaceId: row.workspaceId,
    };
  };

  listQuotas = async (workspaceId: string): Promise<MemberQuotaPolicy[]> => {
    const rows = await this.db
      .select({
        allowedModels: companyMemberQuotas.allowedModels,
        monthlyLimitCost: companyMemberQuotas.monthlyLimitCost,
        userId: companyMemberQuotas.userId,
        workspaceId: companyMemberQuotas.workspaceId,
      })
      .from(companyMemberQuotas)
      .where(eq(companyMemberQuotas.workspaceId, workspaceId));

    return rows.map((row) => ({
      allowedModels: row.allowedModels ?? null,
      monthlyLimitCost:
        row.monthlyLimitCost === null || row.monthlyLimitCost === undefined
          ? null
          : Number(row.monthlyLimitCost),
      userId: row.userId,
      workspaceId: row.workspaceId,
    }));
  };

  /**
   * Sum billed spend for a user in the current 30-day quota cycle (UTC).
   * Prefers the promoted `messages.usage.cost` column.
   */
  getMonthSpend = async (userId: string, now = new Date()): Promise<number> => {
    const { start, end } = getQuotaCycleBounds(now);

    const [row] = await this.db
      .select({
        spend: sql<number>`coalesce(sum(coalesce((${messages.usage}->>'cost')::numeric, 0)), 0)`,
      })
      .from(messages)
      .where(
        and(
          eq(messages.userId, userId),
          gte(messages.createdAt, start),
          lt(messages.createdAt, end),
        ),
      );

    return Number(row?.spend ?? 0);
  };

  upsert = async (input: {
    allowedModels: AllowedModelRef[] | null;
    monthlyLimitCost: number | null;
    updatedBy: string;
    userId: string;
    workspaceId: string;
  }) => {
    const [row] = await this.db
      .insert(companyMemberQuotas)
      .values({
        allowedModels: input.allowedModels,
        monthlyLimitCost: input.monthlyLimitCost,
        updatedBy: input.updatedBy,
        userId: input.userId,
        workspaceId: input.workspaceId,
      })
      .onConflictDoUpdate({
        set: {
          allowedModels: input.allowedModels,
          monthlyLimitCost: input.monthlyLimitCost,
          updatedAt: new Date(),
          updatedBy: input.updatedBy,
        },
        target: [companyMemberQuotas.workspaceId, companyMemberQuotas.userId],
      })
      .returning();

    return row;
  };

  clear = async (workspaceId: string, userId: string) => {
    await this.db
      .delete(companyMemberQuotas)
      .where(
        and(
          eq(companyMemberQuotas.workspaceId, workspaceId),
          eq(companyMemberQuotas.userId, userId),
        ),
      );
  };
}

export const modelKey = (provider: string, model: string) =>
  `${provider.trim().toLowerCase()}::${model.trim()}`;

export const isModelAllowed = (
  allowedModels: AllowedModelRef[] | null | undefined,
  provider: string,
  model: string,
): boolean => {
  if (allowedModels === null || allowedModels === undefined) return true;
  if (allowedModels.length === 0) return false;
  const key = modelKey(provider, model);
  return allowedModels.some((item) => modelKey(item.provider, item.model) === key);
};
