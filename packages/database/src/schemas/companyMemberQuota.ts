import { index, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

import { amountNumeric, timestamps } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Per-member quota + model allowlist for a company workspace.
 *
 * - `monthlyLimitCost`: USD (same unit as message.usage.cost). null = unlimited
 *   (only when a row exists — admin explicitly opened the cap).
 * - `allowedModels`: null = all company-enabled models; [] = none;
 *   otherwise only listed `{ provider, model }` pairs.
 *
 * No row → default company budget (500k credits / month) + all models.
 * Admins create/update rows to raise, lower, unlimited, or lock models.
 */
export interface AllowedModelRef {
  model: string;
  provider: string;
}

export const companyMemberQuotas = pgTable(
  'company_member_quotas',
  {
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /**
     * Monthly spend cap in USD. null = unlimited when the row exists.
     * Missing row uses DEFAULT_MEMBER_MONTHLY_LIMIT_COST (500k credits).
     */
    monthlyLimitCost: amountNumeric('monthly_limit_cost'),
    /**
     * Model allowlist. null = unrestricted; empty array = block all;
     * non-empty = only these provider/model pairs.
     */
    allowedModels: jsonb('allowed_models').$type<AllowedModelRef[] | null>(),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('company_member_quotas_user_id_idx').on(t.userId),
  ],
);

export type CompanyMemberQuotaItem = typeof companyMemberQuotas.$inferSelect;
export type NewCompanyMemberQuota = typeof companyMemberQuotas.$inferInsert;
