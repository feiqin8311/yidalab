import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';

import type { NewCompanyMarketSkill } from '../schemas';
import { companyMarketSkills } from '../schemas';
import type { LobeChatDatabase } from '../type';

const marketSkillColumns = {
  content: companyMarketSkills.content,
  createdAt: companyMarketSkills.createdAt,
  description: companyMarketSkills.description,
  hideContent: companyMarketSkills.hideContent,
  id: companyMarketSkills.id,
  identifier: companyMarketSkills.identifier,
  manifest: companyMarketSkills.manifest,
  name: companyMarketSkills.name,
  publisherId: companyMarketSkills.publisherId,
  resources: companyMarketSkills.resources,
  updatedAt: companyMarketSkills.updatedAt,
  workspaceId: companyMarketSkills.workspaceId,
  zipFileHash: companyMarketSkills.zipFileHash,
};

export class CompanyMarketSkillModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly workspaceId: string,
  ) {}

  private where = (params?: { category?: string; q?: string }) => {
    const conditions = [eq(companyMarketSkills.workspaceId, this.workspaceId)];
    const query = params?.q?.trim();

    if (params?.category) {
      conditions.push(sql`${companyMarketSkills.manifest}->>'category' = ${params.category}`);
    }

    if (query) {
      conditions.push(
        or(
          ilike(companyMarketSkills.name, `%${query}%`),
          ilike(companyMarketSkills.description, `%${query}%`),
          ilike(companyMarketSkills.identifier, `%${query}%`),
        )!,
      );
    }

    return and(...conditions);
  };

  create = async (data: Omit<NewCompanyMarketSkill, 'id' | 'workspaceId'>) => {
    const [result] = await this.db
      .insert(companyMarketSkills)
      .values({ ...data, workspaceId: this.workspaceId })
      .returning(marketSkillColumns);
    return result;
  };

  delete = async (id: string) => {
    const deleted = await this.db
      .delete(companyMarketSkills)
      .where(
        and(eq(companyMarketSkills.id, id), eq(companyMarketSkills.workspaceId, this.workspaceId)),
      )
      .returning({ id: companyMarketSkills.id });
    return { success: deleted.length > 0 };
  };

  findById = async (id: string) => {
    const [result] = await this.db
      .select(marketSkillColumns)
      .from(companyMarketSkills)
      .where(
        and(eq(companyMarketSkills.id, id), eq(companyMarketSkills.workspaceId, this.workspaceId)),
      )
      .limit(1);
    return result;
  };

  findByIdentifier = async (identifier: string) => {
    const [result] = await this.db
      .select(marketSkillColumns)
      .from(companyMarketSkills)
      .where(
        and(
          eq(companyMarketSkills.identifier, identifier),
          eq(companyMarketSkills.workspaceId, this.workspaceId),
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
      params.sort === 'name' ? companyMarketSkills.name : companyMarketSkills.updatedAt;
    const direction = params.order === 'asc' ? asc(orderBy) : desc(orderBy);
    const where = this.where(params);

    const [items, [{ total }]] = await Promise.all([
      this.db
        .select(marketSkillColumns)
        .from(companyMarketSkills)
        .where(where)
        .orderBy(direction)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ total: count() }).from(companyMarketSkills).where(where),
    ]);

    return { currentPage: page, items, pageSize, total: Number(total) };
  };

  listCategories = async (q?: string) => {
    const items = await this.db
      .select({ manifest: companyMarketSkills.manifest })
      .from(companyMarketSkills)
      .where(this.where({ q }));
    const counts = new Map<string, number>();

    for (const { manifest } of items) {
      const category = manifest?.category;
      if (category) counts.set(category, (counts.get(category) || 0) + 1);
    }

    return [...counts.entries()].map(([category, count]) => ({ category, count }));
  };

  update = async (id: string, data: Partial<Omit<NewCompanyMarketSkill, 'id' | 'workspaceId'>>) => {
    const [result] = await this.db
      .update(companyMarketSkills)
      .set(data)
      .where(
        and(eq(companyMarketSkills.id, id), eq(companyMarketSkills.workspaceId, this.workspaceId)),
      )
      .returning(marketSkillColumns);
    return result;
  };
}
