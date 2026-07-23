import { and, desc, eq } from 'drizzle-orm';

import { companyFeedback, type CompanyFeedbackStatus, users } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class CompanyFeedbackModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  create = async (params: { content: string; title: string; workspaceId: string }) => {
    const [row] = await this.db
      .insert(companyFeedback)
      .values({
        content: params.content,
        status: 'pending',
        title: params.title,
        userId: this.userId,
        workspaceId: params.workspaceId,
      })
      .returning();
    return row;
  };

  findById = async (id: string) => {
    const [row] = await this.db
      .select()
      .from(companyFeedback)
      .where(eq(companyFeedback.id, id))
      .limit(1);
    return row;
  };

  list = async (params: { status?: CompanyFeedbackStatus; workspaceId: string }) => {
    const conditions = [eq(companyFeedback.workspaceId, params.workspaceId)];
    if (params.status) conditions.push(eq(companyFeedback.status, params.status));

    return this.db
      .select({
        author: {
          avatar: users.avatar,
          firstName: users.firstName,
          id: users.id,
          lastName: users.lastName,
          username: users.username,
        },
        content: companyFeedback.content,
        createdAt: companyFeedback.createdAt,
        id: companyFeedback.id,
        status: companyFeedback.status,
        statusUpdatedAt: companyFeedback.statusUpdatedAt,
        title: companyFeedback.title,
        updatedAt: companyFeedback.updatedAt,
        userId: companyFeedback.userId,
        workspaceId: companyFeedback.workspaceId,
      })
      .from(companyFeedback)
      .innerJoin(users, eq(companyFeedback.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(companyFeedback.createdAt));
  };

  updateContent = async (id: string, patch: { content?: string; title?: string }) => {
    const row = await this.findById(id);
    if (!row) throw new Error('FEEDBACK_NOT_FOUND');
    if (row.userId !== this.userId) throw new Error('FEEDBACK_NOT_AUTHOR');
    const [updated] = await this.db
      .update(companyFeedback)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
      })
      .where(eq(companyFeedback.id, id))
      .returning();
    return updated;
  };

  updateStatus = async (id: string, status: CompanyFeedbackStatus, actorUserId: string) => {
    const row = await this.findById(id);
    if (!row) throw new Error('FEEDBACK_NOT_FOUND');
    const [updated] = await this.db
      .update(companyFeedback)
      .set({
        status,
        statusUpdatedAt: new Date(),
        statusUpdatedBy: actorUserId,
      })
      .where(eq(companyFeedback.id, id))
      .returning();
    return updated;
  };

  delete = async (id: string) => {
    await this.db.delete(companyFeedback).where(eq(companyFeedback.id, id));
  };
}
