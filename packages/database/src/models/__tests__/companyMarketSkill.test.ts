// @vitest-environment node
import type { SkillManifest } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { CompanyModel } from '../company';
import { CompanyMarketSkillModel } from '../companyMarketSkill';

const serverDB: LobeChatDatabase = await getTestDB();
const ownerId = 'company-market-owner';
const otherOwnerId = 'company-market-other-owner';

const manifest = (category: string): SkillManifest => ({
  category,
  description: 'A company skill',
  name: 'Company Skill',
  version: '1.0.0',
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: ownerId }, { id: otherOwnerId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('CompanyMarketSkillModel', () => {
  it('isolates skills by company workspace', async () => {
    const company = await new CompanyModel(serverDB, ownerId).create({
      departmentName: 'Product',
      name: 'Company One',
      position: 'Owner',
    });
    const otherCompany = await new CompanyModel(serverDB, otherOwnerId).create({
      departmentName: 'Product',
      name: 'Company Two',
      position: 'Owner',
    });
    const market = new CompanyMarketSkillModel(serverDB, company.workspace.id);
    const otherMarket = new CompanyMarketSkillModel(serverDB, otherCompany.workspace.id);

    await market.create({
      content: '# Company Skill',
      description: 'A company skill',
      identifier: 'company.one',
      manifest: manifest('shopping-ecommerce'),
      name: 'Company Skill',
      publisherId: ownerId,
    });
    await otherMarket.create({
      content: '# Other Skill',
      description: 'Another company skill',
      identifier: 'company.two',
      manifest: manifest('marketing-sales'),
      name: 'Other Skill',
      publisherId: otherOwnerId,
    });

    const result = await market.list();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].identifier).toBe('company.one');
    await expect(market.findByIdentifier('company.two')).resolves.toBeUndefined();
  });

  it('returns category counts and deletes only the current company skill', async () => {
    const company = await new CompanyModel(serverDB, ownerId).create({
      departmentName: 'Product',
      name: 'Company One',
      position: 'Owner',
    });
    const market = new CompanyMarketSkillModel(serverDB, company.workspace.id);
    const created = await market.create({
      content: '# Company Skill',
      description: 'A company skill',
      identifier: 'company.one',
      manifest: manifest('shopping-ecommerce'),
      name: 'Company Skill',
      publisherId: ownerId,
    });

    await expect(market.listCategories()).resolves.toEqual([
      { category: 'shopping-ecommerce', count: 1 },
    ]);
    await expect(market.delete(created.id)).resolves.toEqual({ success: true });
    await expect(market.list()).resolves.toMatchObject({ total: 0 });
  });
});
