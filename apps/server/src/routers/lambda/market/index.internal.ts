/**
 * Internal market router: personal creds only (YidaLab needs market.creds.*).
 * Full marketplace / social / OIDC market auth is out of profile.
 */
import { router } from '@/libs/trpc/lambda';

import { credsRouter } from './creds';

export const marketRouter = router({
  creds: credsRouter,
});
