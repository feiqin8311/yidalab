import type { SkillManifest, SkillResourceMeta } from '@lobechat/types';
import { relations } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { globalFiles } from './file';
import { users } from './user';
import { workspaces } from './workspace';

export const companyMarketSkills = pgTable(
  'company_market_skills',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('companyMarketSkills'))
      .primaryKey(),
    identifier: text('identifier').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    manifest: jsonb('manifest')
      .$type<SkillManifest>()
      .notNull()
      .default({} as SkillManifest),
    content: text('content').notNull(),
    hideContent: boolean('hide_content').default(true).notNull(),
    resources: jsonb('resources').$type<Record<string, SkillResourceMeta>>().default({}),
    zipFileHash: varchar('zip_file_hash', { length: 64 }).references(() => globalFiles.hashId, {
      onDelete: 'set null',
    }),
    publisherId: text('publisher_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('company_market_skills_workspace_identifier_unique').on(
      t.workspaceId,
      t.identifier,
    ),
    index('company_market_skills_workspace_updated_idx').on(t.workspaceId, t.updatedAt),
    index('company_market_skills_zip_hash_idx').on(t.zipFileHash),
  ],
);

export const companyMarketSkillsRelations = relations(companyMarketSkills, ({ one }) => ({
  publisher: one(users, {
    fields: [companyMarketSkills.publisherId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [companyMarketSkills.workspaceId],
    references: [workspaces.id],
  }),
  zipFile: one(globalFiles, {
    fields: [companyMarketSkills.zipFileHash],
    references: [globalFiles.hashId],
  }),
}));

export type CompanyMarketSkill = typeof companyMarketSkills.$inferSelect;
export type NewCompanyMarketSkill = typeof companyMarketSkills.$inferInsert;
