'use client';

import { createContext, useContext } from 'react';

import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';

/**
 * Personal vs workspace creds API binding.
 *
 * Self-hosted / second-party default: personal page uses `localCreds`
 * (DB-backed, no Market login). Workspace page may still inject
 * `workspaceCreds` via {@link CredsApiProvider} when implemented.
 *
 * Forms/modals read whichever client/query namespace is active via
 * {@link useCredsApi} and otherwise behave identically.
 */
export interface CredsApi {
  // Structural mirror of market.creds / localCreds — cast keeps shared UI typed.
  client: typeof lambdaClient.localCreds;
  query: typeof lambdaQuery.localCreds;
}

const defaultCredsApi: CredsApi = {
  client: lambdaClient.localCreds,
  query: lambdaQuery.localCreds,
};

const CredsApiContext = createContext<CredsApi | null>(null);

export const CredsApiProvider = CredsApiContext.Provider;

export const useCredsApi = (): CredsApi => useContext(CredsApiContext) ?? defaultCredsApi;
