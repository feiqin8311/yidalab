// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { userCredentials, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UserCredentialModel } from '../userCredential';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'cred-priority-user';
const workspaceId = 'cred-priority-ws';
const validKeyVaultsSecret = 'ofQiJCXLF8mYemwfMWLOHoHimlPu91YmLfU7YZ4lreQ=';

let originalKeyVaultsSecret: string | undefined;

beforeEach(async () => {
  originalKeyVaultsSecret = process.env.KEY_VAULTS_SECRET;
  process.env.KEY_VAULTS_SECRET = validKeyVaultsSecret;

  await serverDB.delete(userCredentials);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId, email: 'cred@example.com' }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: workspaceId, name: 'Co', primaryOwnerId: userId, slug: 'co-priority' }]);
});

afterEach(async () => {
  await serverDB.delete(userCredentials);
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(eq(users.id, userId));
  process.env.KEY_VAULTS_SECRET = originalKeyVaultsSecret;
});

describe('UserCredentialModel listDecrypted priority', () => {
  it('prefers personal non-empty values over company for the same key', async () => {
    const model = new UserCredentialModel(serverDB, userId);

    await model.createCompanyKV(workspaceId, {
      key: 'tavily',
      name: 'Tavily company',
      type: 'kv-env',
      values: { TAVILY_API_KEY: 'company-key' },
    });
    await model.createPersonalKV({
      key: 'tavily',
      name: 'Tavily personal',
      type: 'kv-env',
      values: { TAVILY_API_KEY: 'personal-key' },
    });

    const items = await model.listDecryptedKvEnv(workspaceId);
    const tavily = items.find((i) => i.key === 'tavily');
    expect(tavily?.values.TAVILY_API_KEY).toBe('personal-key');
  });

  it('keeps company value when personal field is empty', async () => {
    const model = new UserCredentialModel(serverDB, userId);

    await model.createCompanyKV(workspaceId, {
      key: 'tavily',
      name: 'Tavily company',
      type: 'kv-env',
      values: { TAVILY_API_KEY: 'company-key' },
    });
    await model.createPersonalKV({
      key: 'tavily',
      name: 'Tavily personal empty',
      type: 'kv-env',
      values: { TAVILY_API_KEY: '' },
    });

    const items = await model.listDecryptedKvEnv(workspaceId);
    const tavily = items.find((i) => i.key === 'tavily');
    expect(tavily?.values.TAVILY_API_KEY).toBe('company-key');
  });

  it('prefers personal non-empty env name across different credential keys', async () => {
    const model = new UserCredentialModel(serverDB, userId);

    await model.createCompanyKV(workspaceId, {
      key: 'shared-search',
      name: 'Company search',
      type: 'kv-env',
      values: { TAVILY_API_KEY: 'company-key' },
    });
    await model.createPersonalKV({
      key: 'tavily',
      name: 'Personal tavily',
      type: 'kv-env',
      values: { TAVILY_API_KEY: 'personal-key' },
    });

    const items = await model.listDecryptedKvEnv(workspaceId);
    const company = items.find((i) => i.key === 'shared-search');
    const personal = items.find((i) => i.key === 'tavily');
    expect(company?.values.TAVILY_API_KEY).toBe('personal-key');
    expect(personal?.values.TAVILY_API_KEY).toBe('personal-key');
  });
});
