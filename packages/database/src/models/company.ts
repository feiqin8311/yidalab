import { and, asc, eq, isNull, ne } from 'drizzle-orm';

import {
  departments,
  users,
  workspaceInvitations,
  type WorkspaceMemberRole,
  workspaceMembers,
  workspaces,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { createNanoId } from '../utils/idGenerator';

export interface CreateCompanyParams {
  departmentName: string;
  name: string;
  position: string;
}

export interface CompanyMembership {
  avatar: string | null;
  creatorName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  id: string;
  name: string;
  position: string | null;
  role: WorkspaceMemberRole;
  slug: string;
}

const invitationColumns = {
  createdAt: workspaceInvitations.createdAt,
  departmentId: workspaceInvitations.departmentId,
  email: workspaceInvitations.email,
  expiresAt: workspaceInvitations.expiresAt,
  id: workspaceInvitations.id,
  inviterId: workspaceInvitations.inviterId,
  position: workspaceInvitations.position,
  role: workspaceInvitations.role,
  status: workspaceInvitations.status,
  token: workspaceInvitations.token,
  updatedAt: workspaceInvitations.updatedAt,
  workspaceId: workspaceInvitations.workspaceId,
};

export class CompanyModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  create = async ({ departmentName, name, position }: CreateCompanyParams) => {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.userId, this.userId), isNull(workspaceMembers.deletedAt)))
        .limit(1);
      if (existing.length > 0) throw new Error('ALREADY_IN_COMPANY');

      const [workspace] = await tx
        .insert(workspaces)
        .values({
          name,
          primaryOwnerId: this.userId,
          slug: `company-${createNanoId(10)()}`,
        })
        .returning();
      const [department] = await tx
        .insert(departments)
        .values({ name: departmentName, workspaceId: workspace.id })
        .returning();
      const [membership] = await tx
        .insert(workspaceMembers)
        .values({
          departmentId: department.id,
          position,
          role: 'owner',
          userId: this.userId,
          workspaceId: workspace.id,
        })
        .returning();

      return { department, membership, workspace };
    });
  };

  createDepartment = async (workspaceId: string, name: string) => {
    const [department] = await this.db
      .insert(departments)
      .values({ name, workspaceId })
      .returning();
    return department;
  };

  createInvitation = async (params: {
    departmentId: string;
    email: string;
    position: string;
    role: Extract<WorkspaceMemberRole, 'admin' | 'member'>;
    workspaceId: string;
  }) => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const [invitation] = await this.db
      .insert(workspaceInvitations)
      .values({
        ...params,
        expiresAt,
        inviterId: this.userId,
        token: createNanoId(32)(),
      })
      .returning();
    return invitation;
  };

  deleteDepartment = async (workspaceId: string, departmentId: string) => {
    const members = await this.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.departmentId, departmentId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .limit(1);
    if (members.length > 0) throw new Error('DEPARTMENT_HAS_MEMBERS');

    await this.db
      .delete(departments)
      .where(and(eq(departments.id, departmentId), eq(departments.workspaceId, workspaceId)));
  };

  findInvitation = async (token: string) => {
    const [invitation] = await this.db
      .select({
        companyName: workspaces.name,
        departmentName: departments.name,
        ...invitationColumns,
      })
      .from(workspaceInvitations)
      .innerJoin(workspaces, eq(workspaceInvitations.workspaceId, workspaces.id))
      .leftJoin(departments, eq(workspaceInvitations.departmentId, departments.id))
      .where(eq(workspaceInvitations.token, token))
      .limit(1);
    return invitation;
  };

  getMembership = async (workspaceId: string, userId = this.userId) => {
    const [membership] = await this.db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .limit(1);
    return membership;
  };

  getMyCompany = async (): Promise<CompanyMembership | null> => {
    const [company] = await this.db
      .select({
        avatar: workspaces.avatar,
        departmentId: workspaceMembers.departmentId,
        departmentName: departments.name,
        id: workspaces.id,
        name: workspaces.name,
        primaryOwnerId: workspaces.primaryOwnerId,
        position: workspaceMembers.position,
        role: workspaceMembers.role,
        slug: workspaces.slug,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .leftJoin(departments, eq(workspaceMembers.departmentId, departments.id))
      .where(and(eq(workspaceMembers.userId, this.userId), isNull(workspaceMembers.deletedAt)))
      .limit(1);
    if (!company) return null;

    const { primaryOwnerId, ...companyData } = company;
    const [creator] = await this.db
      .select({ email: users.email, username: users.username })
      .from(users)
      .where(eq(users.id, primaryOwnerId))
      .limit(1);

    return {
      ...companyData,
      creatorName: creator?.username || creator?.email || null,
    };
  };

  leave = async (workspaceId: string) => {
    const [workspace] = await this.db
      .select({ primaryOwnerId: workspaces.primaryOwnerId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!workspace) throw new Error('COMPANY_NOT_FOUND');
    if (workspace.primaryOwnerId === this.userId) throw new Error('OWNER_CANNOT_LEAVE');

    await this.db
      .update(workspaceMembers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, this.userId),
          isNull(workspaceMembers.deletedAt),
        ),
      );
  };

  listDepartments = async (workspaceId: string) => {
    return this.db
      .select()
      .from(departments)
      .where(eq(departments.workspaceId, workspaceId))
      .orderBy(asc(departments.name));
  };

  listInvitations = async (workspaceId: string) => {
    return this.db
      .select({
        departmentName: departments.name,
        ...invitationColumns,
      })
      .from(workspaceInvitations)
      .leftJoin(departments, eq(workspaceInvitations.departmentId, departments.id))
      .where(eq(workspaceInvitations.workspaceId, workspaceId))
      .orderBy(asc(workspaceInvitations.createdAt));
  };

  listMineWorkspaces = async () => {
    return this.db
      .select({
        avatar: workspaces.avatar,
        createdAt: workspaces.createdAt,
        description: workspaces.description,
        frozen: workspaces.frozen,
        frozenAt: workspaces.frozenAt,
        frozenReason: workspaces.frozenReason,
        id: workspaces.id,
        name: workspaces.name,
        primaryOwnerId: workspaces.primaryOwnerId,
        role: workspaceMembers.role,
        settings: workspaces.settings,
        slug: workspaces.slug,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(and(eq(workspaceMembers.userId, this.userId), isNull(workspaceMembers.deletedAt)));
  };

  listMembers = async (workspaceId: string) => {
    return this.db
      .select({
        avatar: users.avatar,
        deletedAt: workspaceMembers.deletedAt,
        departmentId: workspaceMembers.departmentId,
        departmentName: departments.name,
        email: users.email,
        username: users.username,
        joinedAt: workspaceMembers.joinedAt,
        position: workspaceMembers.position,
        role: workspaceMembers.role,
        updatedAt: workspaceMembers.updatedAt,
        userId: workspaceMembers.userId,
        workspaceId: workspaceMembers.workspaceId,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .leftJoin(departments, eq(workspaceMembers.departmentId, departments.id))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), isNull(workspaceMembers.deletedAt)))
      .orderBy(asc(workspaceMembers.joinedAt));
  };

  revokeInvitation = async (workspaceId: string, invitationId: string) => {
    await this.db
      .update(workspaceInvitations)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(
        and(
          eq(workspaceInvitations.id, invitationId),
          eq(workspaceInvitations.workspaceId, workspaceId),
          eq(workspaceInvitations.status, 'pending'),
        ),
      );
  };

  updateCompany = async (workspaceId: string, name: string) => {
    const [workspace] = await this.db
      .update(workspaces)
      .set({ name, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    return workspace;
  };

  updateDepartment = async (workspaceId: string, departmentId: string, name: string) => {
    const [department] = await this.db
      .update(departments)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(departments.id, departmentId), eq(departments.workspaceId, workspaceId)))
      .returning();
    return department;
  };

  updateMember = async (params: {
    departmentId: string;
    position: string;
    role: Extract<WorkspaceMemberRole, 'admin' | 'member' | 'owner'>;
    userId: string;
    workspaceId: string;
  }) => {
    const [member] = await this.db
      .update(workspaceMembers)
      .set({
        departmentId: params.departmentId,
        position: params.position,
        role: params.role,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workspaceMembers.workspaceId, params.workspaceId),
          eq(workspaceMembers.userId, params.userId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .returning();
    return member;
  };

  acceptInvitation = async (token: string) => {
    return this.db.transaction(async (tx) => {
      const [invitation] = await tx
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.token, token))
        .limit(1);
      if (!invitation) throw new Error('INVITATION_NOT_FOUND');
      if (invitation.status !== 'pending') throw new Error('INVITATION_NOT_PENDING');
      if (invitation.expiresAt <= new Date()) {
        await tx
          .update(workspaceInvitations)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(workspaceInvitations.id, invitation.id));
        throw new Error('INVITATION_EXPIRED');
      }

      const [user] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, this.userId))
        .limit(1);
      if (!user?.email || user.email.toLowerCase() !== invitation.email?.toLowerCase())
        throw new Error('INVITATION_EMAIL_MISMATCH');

      const memberships = await tx
        .select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.userId, this.userId), isNull(workspaceMembers.deletedAt)))
        .limit(1);
      if (memberships.length > 0) throw new Error('ALREADY_IN_COMPANY');

      const [membership] = await tx
        .insert(workspaceMembers)
        .values({
          departmentId: invitation.departmentId,
          position: invitation.position,
          role: invitation.role === 'admin' ? 'admin' : 'member',
          userId: this.userId,
          workspaceId: invitation.workspaceId,
        })
        .returning();
      await tx
        .update(workspaceInvitations)
        .set({ status: 'accepted', updatedAt: new Date() })
        .where(eq(workspaceInvitations.id, invitation.id));

      return membership;
    });
  };

  removeMember = async (workspaceId: string, userId: string) => {
    await this.db
      .update(workspaceMembers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
          isNull(workspaceMembers.deletedAt),
        ),
      );
  };

  transferOwnership = async (workspaceId: string, userId: string) => {
    return this.db.transaction(async (tx) => {
      await tx
        .update(workspaceMembers)
        .set({ role: 'owner', updatedAt: new Date() })
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
            isNull(workspaceMembers.deletedAt),
          ),
        );
      await tx
        .update(workspaceMembers)
        .set({ role: 'admin', updatedAt: new Date() })
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, this.userId),
            ne(workspaceMembers.userId, userId),
            isNull(workspaceMembers.deletedAt),
          ),
        );
      const [workspace] = await tx
        .update(workspaces)
        .set({ primaryOwnerId: userId, updatedAt: new Date() })
        .where(eq(workspaces.id, workspaceId))
        .returning();
      return workspace;
    });
  };
}
