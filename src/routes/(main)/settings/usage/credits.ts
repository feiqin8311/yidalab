import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';

export {
  DEFAULT_MEMBER_MONTHLY_CREDITS,
  DEFAULT_MEMBER_MONTHLY_LIMIT_COST,
} from '@/database/models/companyMemberQuota';

/** LobeHub: 1 USD = 1_000_000 credits (same as cost pipeline). */
export const usdToCredits = (usd: number | null | undefined): number =>
  Math.ceil((usd || 0) * CREDITS_PER_DOLLAR);

export const creditsToUsd = (credits: number): number => credits / CREDITS_PER_DOLLAR;
