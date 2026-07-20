'use client';

/**
 * Workspace credential settings (self-hosted / second-party).
 *
 * Market org sharing is disabled — reuse the personal localCreds page so
 * each signed-in user manages their own DB-backed credentials without a
 * Market login. Workspace-shared credentials can be added later by scoping
 * `UserCredentialModel` with workspaceId.
 */
export { default } from '@/routes/(main)/settings/creds';
