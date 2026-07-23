import { index, pgTable, text } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

export const COMPANY_FEEDBACK_STATUSES = ['pending', 'accepted', 'declined'] as const;
export type CompanyFeedbackStatus = (typeof COMPANY_FEEDBACK_STATUSES)[number];

export const companyFeedback = pgTable(
  'company_feedback',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .$defaultFn(() => idGenerator('companyFeedback')),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    status: text('status').$type<CompanyFeedbackStatus>().notNull().default('pending'),
    statusUpdatedAt: timestamptz('status_updated_at'),
    statusUpdatedBy: text('status_updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => [
    index('company_feedback_workspace_created_idx').on(t.workspaceId, t.createdAt),
    index('company_feedback_workspace_status_idx').on(t.workspaceId, t.status),
  ],
);

export type CompanyFeedbackItem = typeof companyFeedback.$inferSelect;
export type NewCompanyFeedback = typeof companyFeedback.$inferInsert;
