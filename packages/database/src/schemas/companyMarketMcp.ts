import { relations } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

export interface CompanyMarketMcpConnection {
  auth?: { type: 'none' | 'bearer' | 'oauth2'; token?: string };
  headers?: Record<string, string>;
  type: 'http' | 'stdio' | 'sse';
  url?: string;
}

export interface CompanyMarketMcpManifest {
  author?: string;
  category?: string;
  connection: CompanyMarketMcpConnection;
  description?: string;
  icon?: string;
  name?: string;
  tags?: string[];
  version?: string;
}

export const companyMarketMcps = pgTable(
  'company_market_mcps',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('companyMarketMcps'))
      .primaryKey(),
    identifier: text('identifier').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    icon: text('icon'),
    category: text('category'),
    tags: jsonb('tags').$type<string[]>().default([]),
    connection: jsonb('connection')
      .$type<CompanyMarketMcpConnection>()
      .notNull()
      .default({ type: 'http' } as CompanyMarketMcpConnection),
    tools: jsonb('tools').$type<Array<Record<string, unknown>>>().default([]),
    prompts: jsonb('prompts').$type<Array<Record<string, unknown>>>().default([]),
    publisherId: text('publisher_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('company_market_mcps_workspace_identifier_unique').on(t.workspaceId, t.identifier),
    index('company_market_mcps_workspace_updated_idx').on(t.workspaceId, t.updatedAt),
  ],
);

export const companyMarketMcpsRelations = relations(companyMarketMcps, ({ one }) => ({
  publisher: one(users, {
    fields: [companyMarketMcps.publisherId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [companyMarketMcps.workspaceId],
    references: [workspaces.id],
  }),
}));

export type CompanyMarketMcp = typeof companyMarketMcps.$inferSelect;
export type NewCompanyMarketMcp = typeof companyMarketMcps.$inferInsert;
