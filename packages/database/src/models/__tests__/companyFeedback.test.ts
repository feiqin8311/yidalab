// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { companyFeedback, users, workspaceMembers, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { CompanyFeedbackModel } from '../companyFeedback';

const serverDB: LobeChatDatabase = await getTestDB();
const authorId = 'user-author';
const adminId = 'user-admin';
const workspaceId = 'ws_feedback_test';

beforeEach(async () => {
  await serverDB.delete(companyFeedback);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([
    { id: authorId, username: 'author' },
    { id: adminId, username: 'admin' },
  ]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Acme',
    primaryOwnerId: adminId,
    slug: 'acme-fb',
  });
  await serverDB.insert(workspaceMembers).values([
    { role: 'member', userId: authorId, workspaceId },
    { role: 'admin', userId: adminId, workspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(companyFeedback);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('CompanyFeedbackModel', () => {
  it('creates pending feedback and lists with author', async () => {
    const model = new CompanyFeedbackModel(serverDB, authorId);
    const created = await model.create({
      content: 'Need export to Excel',
      title: 'Export',
      workspaceId,
    });
    expect(created.status).toBe('pending');
    expect(created.title).toBe('Export');

    const list = await model.list({ workspaceId });
    expect(list).toHaveLength(1);
    expect(list[0].author?.username).toBe('author');
  });

  it('filters by status', async () => {
    const model = new CompanyFeedbackModel(serverDB, authorId);
    await model.create({ content: 'a', title: 'A', workspaceId });
    const b = await model.create({ content: 'b', title: 'B', workspaceId });
    await model.updateStatus(b.id, 'accepted', adminId);

    const pending = await model.list({ status: 'pending', workspaceId });
    expect(pending.map((x) => x.title)).toEqual(['A']);
  });

  it('only author can update content', async () => {
    const authorModel = new CompanyFeedbackModel(serverDB, authorId);
    const row = await authorModel.create({ content: 'x', title: 'T', workspaceId });
    const other = new CompanyFeedbackModel(serverDB, adminId);
    await expect(other.updateContent(row.id, { title: 'Hacked' })).rejects.toThrow(
      'FEEDBACK_NOT_AUTHOR',
    );
    const updated = await authorModel.updateContent(row.id, { title: 'T2' });
    expect(updated.title).toBe('T2');
  });

  it('updateStatus sets metadata', async () => {
    const model = new CompanyFeedbackModel(serverDB, authorId);
    const row = await model.create({ content: 'x', title: 'T', workspaceId });
    const updated = await model.updateStatus(row.id, 'declined', adminId);
    expect(updated.status).toBe('declined');
    expect(updated.statusUpdatedBy).toBe(adminId);
    expect(updated.statusUpdatedAt).toBeTruthy();
  });

  it('delete removes row', async () => {
    const model = new CompanyFeedbackModel(serverDB, authorId);
    const row = await model.create({ content: 'x', title: 'T', workspaceId });
    await model.delete(row.id);
    expect(await model.findById(row.id)).toBeUndefined();
  });
});
