import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';

import type { NewCompanyMarketMcp } from '../schemas';
import { companyMarketMcps } from '../schemas';
import type { LobeChatDatabase } from '../type';

const columns = {
  category: companyMarketMcps.category,
  connection: companyMarketMcps.connection,
  createdAt: companyMarketMcps.createdAt,
  description: companyMarketMcps.description,
  icon: companyMarketMcps.icon,
  id: companyMarketMcps.id,
  identifier: companyMarketMcps.identifier,
  name: companyMarketMcps.name,
  prompts: companyMarketMcps.prompts,
  publisherId: companyMarketMcps.publisherId,
  tags: companyMarketMcps.tags,
  tools: companyMarketMcps.tools,
  updatedAt: companyMarketMcps.updatedAt,
  workspaceId: companyMarketMcps.workspaceId,
};

export class CompanyMarketMcpModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly workspaceId: string,
  ) {}

  private where = (params?: { category?: string; q?: string }) => {
    const conditions = [eq(companyMarketMcps.workspaceId, this.workspaceId)];
    const query = params?.q?.trim();

    if (params?.category) conditions.push(eq(companyMarketMcps.category, params.category));
    if (query) {
      conditions.push(
        or(
          ilike(companyMarketMcps.name, `%${query}%`),
          ilike(companyMarketMcps.description, `%${query}%`),
          ilike(companyMarketMcps.identifier, `%${query}%`),
        )!,
      );
    }

    return and(...conditions);
  };

  create = async (data: Omit<NewCompanyMarketMcp, 'id' | 'workspaceId'>) => {
    const [result] = await this.db
      .insert(companyMarketMcps)
      .values({ ...data, workspaceId: this.workspaceId })
      .returning(columns);
    return result;
  };

  delete = async (id: string) => {
    const deleted = await this.db
      .delete(companyMarketMcps)
      .where(and(eq(companyMarketMcps.id, id), eq(companyMarketMcps.workspaceId, this.workspaceId)))
      .returning({ id: companyMarketMcps.id });
    return { success: deleted.length > 0 };
  };

  findByIdentifier = async (identifier: string) => {
    const [result] = await this.db
      .select(columns)
      .from(companyMarketMcps)
      .where(
        and(
          eq(companyMarketMcps.identifier, identifier),
          eq(companyMarketMcps.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);
    return result;
  };

  list = async (
    params: {
      category?: string;
      order?: 'asc' | 'desc';
      page?: number;
      pageSize?: number;
      q?: string;
      sort?: 'createdAt' | 'name' | 'updatedAt';
    } = {},
  ) => {
    const page = Math.max(params.page || 1, 1);
    const pageSize = Math.min(Math.max(params.pageSize || 21, 1), 100);
    const orderBy =
      params.sort === 'name'
        ? companyMarketMcps.name
        : params.sort === 'createdAt'
          ? companyMarketMcps.createdAt
          : companyMarketMcps.updatedAt;
    const direction = params.order === 'asc' ? asc(orderBy) : desc(orderBy);
    const where = this.where(params);

    const [items, [{ total }]] = await Promise.all([
      this.db
        .select(columns)
        .from(companyMarketMcps)
        .where(where)
        .orderBy(direction)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ total: count() }).from(companyMarketMcps).where(where),
    ]);

    return { currentPage: page, items, pageSize, total: Number(total) };
  };

  listCategories = async (q?: string) => {
    const items = await this.db
      .select({ category: companyMarketMcps.category })
      .from(companyMarketMcps)
      .where(this.where({ q }));
    const counts = new Map<string, number>();
    for (const { category } of items) {
      if (category) counts.set(category, (counts.get(category) || 0) + 1);
    }
    return [...counts.entries()].map(([category, count]) => ({ category, count }));
  };

  static listAll = async (db: LobeChatDatabase) => {
    return db.select(columns).from(companyMarketMcps).orderBy(desc(companyMarketMcps.updatedAt));
  };

  static findByIdentifierGlobal = async (db: LobeChatDatabase, identifier: string) => {
    const [result] = await db
      .select(columns)
      .from(companyMarketMcps)
      .where(eq(companyMarketMcps.identifier, identifier))
      .limit(1);
    return result;
  };
}
