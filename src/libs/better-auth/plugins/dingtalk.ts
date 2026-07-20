import { serverDB } from '@lobechat/database';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { type BetterAuthPlugin } from 'better-auth/types';
import { z } from 'zod';

import { UserModel } from '@/database/models/user';
import {
  type DingTalkUserProfile,
  getDingTalkBootstrapConfig,
  getDingTalkUserByAuthCode,
  isDingTalkAuthConfigured,
  signDingTalkJsapi,
} from '@/server/services/dingtalk/auth';

const PROVIDER_ID = 'dingtalk';
const LOG = '[DingTalkSSO]';

/**
 * DingTalk workbench free-login (免登) via JSAPI auth code.
 *
 * Endpoints (under better-auth base path, typically /api/auth):
 * - GET  /dingtalk/bootstrap   corpId/agentId for free-login without full JSAPI sign
 * - POST /dingtalk/jsapi-sign  { url }
 * - POST /dingtalk/login       { authCode }
 *
 * User resolution order (important for YidaLab pre-provisioned users):
 * 1. existing dingtalk account (unionid, then userid)
 * 2. real email from DingTalk profile
 * 3. username match — better-auth maps `name` → `users.username`, and company
 *    users are seeded with Chinese display names as username (e.g. 柯鹏翔)
 * 4. create a new user only if none of the above match
 */
export const dingtalkAuthPlugin = (): BetterAuthPlugin => ({
  id: 'dingtalk-auth',
  endpoints: {
    dingtalkBootstrap: createAuthEndpoint(
      '/dingtalk/bootstrap',
      {
        method: 'GET',
      },
      async (ctx) => {
        if (!isDingTalkAuthConfigured()) {
          throw new APIError('BAD_REQUEST', {
            message: 'DingTalk auth is not configured',
          });
        }
        const config = getDingTalkBootstrapConfig();
        console.info(LOG, 'bootstrap', { corpId: config.corpId, agentId: config.agentId });
        return ctx.json(config);
      },
    ),

    dingtalkJsapiSign: createAuthEndpoint(
      '/dingtalk/jsapi-sign',
      {
        body: z.object({
          url: z.string().min(1),
        }),
        method: 'POST',
      },
      async (ctx) => {
        if (!isDingTalkAuthConfigured()) {
          throw new APIError('BAD_REQUEST', {
            message: 'DingTalk auth is not configured',
          });
        }

        try {
          const sign = await signDingTalkJsapi(ctx.body.url);
          console.info(LOG, 'jsapi-sign ok', { url: ctx.body.url, corpId: sign.corpId });
          return ctx.json(sign);
        } catch (error) {
          console.error(LOG, 'jsapi-sign failed', error);
          throw new APIError('BAD_REQUEST', {
            message: error instanceof Error ? error.message : 'JSAPI sign failed',
          });
        }
      },
    ),

    dingtalkLogin: createAuthEndpoint(
      '/dingtalk/login',
      {
        body: z.object({
          authCode: z.string().min(1),
        }),
        method: 'POST',
      },
      async (ctx) => {
        if (!isDingTalkAuthConfigured()) {
          throw new APIError('BAD_REQUEST', {
            message: 'DingTalk auth is not configured',
          });
        }

        let profile: DingTalkUserProfile;
        try {
          profile = await getDingTalkUserByAuthCode(ctx.body.authCode);
        } catch (error) {
          console.error(LOG, 'getuserinfo failed', error);
          throw new APIError('UNAUTHORIZED', {
            message: error instanceof Error ? error.message : 'DingTalk login failed',
          });
        }

        // Prefer stable unionid for the account row; fall back to corp userid.
        const primaryAccountId = (profile.unionid || profile.userid).trim();
        const accountIds = [
          ...new Set([profile.unionid, profile.userid].filter(Boolean).map(String)),
        ];
        const syntheticEmail =
          profile.email?.trim().toLowerCase() || `${primaryAccountId}@dingtalk.yidalab`;
        const displayName = (profile.name || profile.userid).trim() || primaryAccountId;

        console.info(LOG, 'login profile', {
          userid: profile.userid,
          unionid: profile.unionid,
          name: profile.name,
          hasEmail: Boolean(profile.email),
          hasMobile: Boolean(profile.mobile),
          displayName,
          syntheticEmail,
        });

        let linkedAccountId: string | undefined;
        let existingAccount: { accountId?: string; userId?: string } | null = null;

        for (const accountId of accountIds) {
          const found = await ctx.context.internalAdapter.findAccountByProviderId(
            accountId,
            PROVIDER_ID,
          );
          if (found?.userId) {
            existingAccount = found;
            linkedAccountId = accountId;
            console.info(LOG, 'matched dingtalk account', { accountId, userId: found.userId });
            break;
          }
        }

        let user = existingAccount?.userId
          ? await ctx.context.internalAdapter.findUserById(existingAccount.userId)
          : null;

        // Email match — only when DingTalk actually returned a real email.
        if (!user && profile.email?.trim()) {
          const byEmail = await ctx.context.internalAdapter.findUserByEmail(
            profile.email.trim().toLowerCase(),
          );
          user = byEmail?.user ?? null;
          if (user) console.info(LOG, 'matched user by email', { userId: user.id });
        }

        // Username match — YidaLab stores Chinese display names in users.username
        // (better-auth field map: name → username). Pre-seeded staff land here.
        if (!user && displayName) {
          const byUsername = await UserModel.findByUsername(serverDB, displayName);
          if (byUsername) {
            user = await ctx.context.internalAdapter.findUserById(byUsername.id);
            if (user) {
              console.info(LOG, 'matched user by username', {
                userId: user.id,
                username: displayName,
              });
            }
          }
        }

        if (!user) {
          try {
            user = await ctx.context.internalAdapter.createUser({
              email: syntheticEmail,
              emailVerified: Boolean(profile.email),
              image: profile.avatar,
              // maps to users.username via better-auth field config
              name: displayName,
            });
            console.info(LOG, 'created new user', { userId: user?.id, email: syntheticEmail });
          } catch (error) {
            // Race / unique collision on username or email — re-resolve once.
            console.warn(LOG, 'createUser failed, re-resolving', error);
            const byUsername = displayName
              ? await UserModel.findByUsername(serverDB, displayName)
              : null;
            if (byUsername) {
              user = await ctx.context.internalAdapter.findUserById(byUsername.id);
            }
            if (!user && profile.email?.trim()) {
              const byEmail = await ctx.context.internalAdapter.findUserByEmail(
                profile.email.trim().toLowerCase(),
              );
              user = byEmail?.user ?? null;
            }
            if (!user) {
              throw new APIError('INTERNAL_SERVER_ERROR', {
                message:
                  error instanceof Error
                    ? `Failed to create user: ${error.message}`
                    : 'Failed to create user',
              });
            }
            console.info(LOG, 're-resolved user after create conflict', { userId: user.id });
          }
        }

        if (!user) {
          throw new APIError('INTERNAL_SERVER_ERROR', {
            message: 'Failed to resolve user for DingTalk login',
          });
        }

        // Best-effort avatar refresh only — never rewrite username/email of an existing account.
        if (profile.avatar) {
          try {
            await ctx.context.internalAdapter.updateUser(user.id, {
              image: profile.avatar,
            });
          } catch {
            // ignore
          }
        }

        // Link dingtalk provider account if missing (use primaryAccountId for new rows).
        if (!existingAccount) {
          try {
            await ctx.context.internalAdapter.createAccount({
              accountId: primaryAccountId,
              providerId: PROVIDER_ID,
              userId: user.id,
            });
            linkedAccountId = primaryAccountId;
            console.info(LOG, 'linked dingtalk account', {
              accountId: primaryAccountId,
              userId: user.id,
            });
          } catch (error) {
            // Concurrent link is fine — login can proceed.
            console.warn(LOG, 'createAccount skipped/failed', error);
          }
        }

        const session = await ctx.context.internalAdapter.createSession(user.id);
        if (!session) {
          throw new APIError('INTERNAL_SERVER_ERROR', {
            message: 'Failed to create session',
          });
        }

        await setSessionCookie(ctx, { session, user });

        console.info(LOG, 'login success', {
          userId: user.id,
          sessionTokenPrefix: String(session.token || '').slice(0, 8),
          linkedAccountId,
        });

        return ctx.json({
          session: {
            expiresAt: session.expiresAt,
            token: session.token,
            userId: session.userId,
          },
          user: {
            email: user.email,
            id: user.id,
            image: user.image,
            name: user.name,
          },
        });
      },
    ),
  },
});
