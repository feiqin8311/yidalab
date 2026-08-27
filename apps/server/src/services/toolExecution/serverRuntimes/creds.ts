import {
  CredsExecutionRuntime,
  CredsIdentifier,
  type ICredsService,
} from '@lobechat/builtin-tool-creds';
import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { CompanyModel } from '@/database/models/company';
import { UserCredentialModel } from '@/database/models/userCredential';
import { MarketService } from '@/server/services/market';
import { injectVaultCreds, listVaultCredSummaries } from '@/server/utils/withVaultCredEnv';

import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:creds-runtime');

/**
 * Server-side Creds Service.
 * KV list/inject/save hit the local `user_credentials` vault (Settings → Credentials).
 * OAuth still goes through Market (local OAuth creds are not implemented).
 */
class ServerCredsService implements ICredsService {
  constructor(
    private readonly marketService: MarketService,
    private readonly userId: string,
    private readonly serverDB?: LobeChatDatabase,
  ) {}

  async getByKey(
    key: string,
    options?: { decrypt?: boolean },
  ): Promise<{
    fileName?: string;
    fileUrl?: string;
    name?: string;
    plaintext?: Record<string, string>;
    type: string;
    values?: Record<string, string>;
  }> {
    log('getByKey: key=%s, decrypt=%s', key, options?.decrypt);

    if (!this.serverDB) throw new Error('Credential not found: ' + key);

    const model = new UserCredentialModel(this.serverDB, this.userId);
    const personal = await model.getPersonalByKey(key, { decrypt: options?.decrypt });
    if (personal) {
      return { ...personal, values: personal.plaintext };
    }

    const company = await new CompanyModel(this.serverDB, this.userId).getMyCompany();
    if (company?.id) {
      const row = await model.findCompanyByKey(company.id, key);
      if (row) {
        const full = await model.getCompany(company.id, row.id, { decrypt: options?.decrypt });
        if (full) return { ...full, values: full.plaintext };
      }
    }

    throw new Error(`Credential not found: ${key}`);
  }

  async getOAuthAuthorizeUrl(
    provider: string,
    redirectUri: string,
  ): Promise<{
    authorizeUrl: string;
  }> {
    log('getOAuthAuthorizeUrl: provider=%s', provider);

    const response = await this.marketService.market.connect.authorize(provider, {
      redirect_uri: redirectUri,
    });

    return {
      authorizeUrl: response.authorize_url,
    };
  }

  async getOAuthConnectionStatus(provider: string): Promise<{
    connected: boolean;
  }> {
    log('getOAuthConnectionStatus: provider=%s', provider);

    const response = await this.marketService.market.connect.getStatus(provider);

    return {
      connected: response.connected,
    };
  }

  async injectCreds(params: {
    keys: string[];
    sandbox?: boolean;
    topicId: string;
    userId: string;
  }): Promise<{
    credentials?: {
      env?: Record<string, string>;
      files?: Array<{ filename: string; key: string; path: string }>;
    };
    notFound?: string[];
    success: boolean;
    unsupportedInSandbox?: string[];
  }> {
    log('injectCreds: keys=%O, topicId=%s', params.keys, params.topicId);

    const result = await injectVaultCreds(this.userId, this.serverDB, params.keys);

    log('injectCreds success: notFound=%d', result.notFound.length);

    return result;
  }

  async listCreds(): Promise<{
    data?: Array<{ id: number; key: string }>;
  }> {
    log('listCreds');

    const data = await listVaultCredSummaries(this.userId, this.serverDB);

    log('listCreds success: %d credentials', data.length);

    return { data };
  }

  async saveKVCred(params: {
    description?: string;
    key: string;
    name: string;
    type: 'kv-env' | 'kv-header';
    values: Record<string, string>;
  }): Promise<{ id: number }> {
    log('saveKVCred: key=%s, name=%s, type=%s', params.key, params.name, params.type);

    if (!this.serverDB) throw new Error('Database is required to save credentials');

    const result = await new UserCredentialModel(this.serverDB, this.userId).upsertPersonalKV(
      params,
    );

    log('saveKVCred success: id=%d', result.id);

    return { id: result.id };
  }
}

/**
 * Creds Server Runtime
 * Per-request runtime (needs userId, topicId)
 */
export const credsRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Creds execution');
    }

    log(
      'Creating CredsExecutionRuntime for userId=%s, topicId=%s, workspaceId=%s',
      context.userId,
      context.topicId,
      context.workspaceId,
    );

    const marketService = new MarketService({ userInfo: { userId: context.userId } });
    const credsService = new ServerCredsService(marketService, context.userId, context.serverDB);

    return new CredsExecutionRuntime(credsService, {
      topicId: context.topicId,
      userId: context.userId,
    });
  },
  identifier: CredsIdentifier,
};
