import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaceMembers } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { CompanyModel } from '../company';

const serverDB: LobeChatDatabase = await getTestDB();
const ownerId = 'company-owner';
const memberId = 'company-member';
const otherId = 'company-other';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { email: 'owner@example.com', id: ownerId },
    { email: 'member@example.com', id: memberId },
    { email: 'other@example.com', id: otherId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('CompanyModel', () => {
  it('creates the company, its first department, and the owner membership atomically', async () => {
    await serverDB.update(users).set({ username: '柯鹏' }).where(eq(users.id, ownerId));
    const result = await new CompanyModel(serverDB, ownerId).create({
      departmentName: 'Product',
      name: 'YidaLab',
      position: 'Founder',
    });

    expect(result.workspace.name).toBe('YidaLab');
    expect(result.department.workspaceId).toBe(result.workspace.id);
    expect(result.membership).toMatchObject({
      departmentId: result.department.id,
      position: 'Founder',
      role: 'owner',
      userId: ownerId,
    });

    await expect(new CompanyModel(serverDB, ownerId).getMyCompany()).resolves.toMatchObject({
      creatorName: '柯鹏',
      id: result.workspace.id,
    });
  });

  it('prevents a user from creating or joining a second active company', async () => {
    const owner = new CompanyModel(serverDB, ownerId);
    await owner.create({ departmentName: 'Product', name: 'YidaLab', position: 'Founder' });

    await expect(
      owner.create({ departmentName: 'Sales', name: 'Another', position: 'Founder' }),
    ).rejects.toThrow('ALREADY_IN_COMPANY');
  });

  it('accepts an email-bound invitation and stores the invited department and position', async () => {
    const owner = new CompanyModel(serverDB, ownerId);
    const created = await owner.create({
      departmentName: 'Product',
      name: 'YidaLab',
      position: 'Founder',
    });
    const invitation = await owner.createInvitation({
      departmentId: created.department.id,
      email: 'member@example.com',
      position: 'Product Manager',
      role: 'member',
      workspaceId: created.workspace.id,
    });

    const member = await new CompanyModel(serverDB, memberId).acceptInvitation(invitation.token);

    expect(member).toMatchObject({
      departmentId: created.department.id,
      position: 'Product Manager',
      role: 'member',
      userId: memberId,
      workspaceId: created.workspace.id,
    });
    const rows = await serverDB
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, memberId));
    expect(rows).toHaveLength(1);
  });

  it('rejects an invitation when the signed-in email does not match', async () => {
    const owner = new CompanyModel(serverDB, ownerId);
    const created = await owner.create({
      departmentName: 'Product',
      name: 'YidaLab',
      position: 'Founder',
    });
    const invitation = await owner.createInvitation({
      departmentId: created.department.id,
      email: 'member@example.com',
      position: 'Product Manager',
      role: 'member',
      workspaceId: created.workspace.id,
    });

    await expect(
      new CompanyModel(serverDB, otherId).acceptInvitation(invitation.token),
    ).rejects.toThrow('INVITATION_EMAIL_MISMATCH');
  });

  it('does not let a department be deleted while it has active members', async () => {
    const owner = new CompanyModel(serverDB, ownerId);
    const created = await owner.create({
      departmentName: 'Product',
      name: 'YidaLab',
      position: 'Founder',
    });

    await expect(
      owner.deleteDepartment(created.workspace.id, created.department.id),
    ).rejects.toThrow('DEPARTMENT_HAS_MEMBERS');
  });
});
