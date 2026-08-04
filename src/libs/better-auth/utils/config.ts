import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { getRedisConfig } from '@/envs/redis';
import { initializeRedis, isRedisEnabled } from '@/libs/redis';
import { isDev } from '@/utils/env';

const APPLE_TRUSTED_ORIGIN = 'https://appleid.apple.com';
const MOBILE_APP_SCHEME = 'com.lobehub.app://';
const EXPO_DEV_SCHEME = 'exp://*/*';

/**
 * Normalize a URL-like string to an origin with https fallback.
 * Returns the original string if it's a custom scheme (e.g., com.lobehub.app://).
 */
export const normalizeOrigin = (url?: string) => {
  if (!url) return undefined;

  // Handle custom schemes (e.g., mobile app deep links)
  if (url.includes('://') && !url.startsWith('http')) {
    return url;
  }

  try {
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

    return new URL(normalizedUrl).origin;
  } catch {
    return undefined;
  }
};

/**
 * Build trusted origins with env override and Vercel-aware defaults.
 */
export const getTrustedOrigins = (enabledSSOProviders: string[]) => {
  if (authEnv.AUTH_TRUSTED_ORIGINS) {
    const originsFromEnv = authEnv.AUTH_TRUSTED_ORIGINS.split(',')
      .map((item) => {
        const trimmed = item.trim();
        // Handle custom schemes directly
        if (trimmed.includes('://') && !trimmed.startsWith('http')) {
          return trimmed;
        }
        return normalizeOrigin(trimmed);
      })
      .filter(Boolean) as string[];

    if (originsFromEnv.length > 0) return Array.from(new Set(originsFromEnv));
  }

  const defaults = [
    normalizeOrigin(appEnv.APP_URL),
    normalizeOrigin(process.env.VERCEL_URL),
    normalizeOrigin(process.env.VERCEL_BRANCH_URL),
    MOBILE_APP_SCHEME,
    // Add expo URL in development
    ...(isDev ? [EXPO_DEV_SCHEME] : []),
  ].filter(Boolean) as string[];

  const baseTrustedOrigins = defaults.length > 0 ? Array.from(new Set(defaults)) : undefined;

  if (!enabledSSOProviders.includes('apple')) return baseTrustedOrigins;

  const mergedOrigins = new Set(baseTrustedOrigins || []);
  mergedOrigins.add(APPLE_TRUSTED_ORIGIN);

  return Array.from(mergedOrigins);
};

/**
 * Build Better Auth secondaryStorage backed by Redis.
 * Uses the shared Redis manager to avoid duplicate connections and prefixes keys to prevent clashes.
 *
 * Fail-open: Redis blips must NOT break sign-in / get-session. With
 * `session.storeSessionInDatabase: true`, Better Auth falls back to Postgres
 * when `get` returns null. Throwing here surfaced as
 * "Connection is closed" → UI "请检查账号与密码".
 */
export const createSecondaryStorage = () => {
  const redisConfig = getRedisConfig();
  if (!isRedisEnabled(redisConfig)) return undefined;

  const secondaryStorageKeyPrefix = 'better-auth:';

  const buildKey = (key: string) => `${secondaryStorageKeyPrefix}${key}`;

  const getRedisClient = async () => {
    try {
      return await initializeRedis(redisConfig);
    } catch (error) {
      console.error('[better-auth secondaryStorage] redis init failed:', error);
      return null;
    }
  };

  return {
    delete: async (key: string) => {
      try {
        const redisClient = await getRedisClient();
        if (!redisClient) return;
        await redisClient.del(buildKey(key));
      } catch (error) {
        console.error('[better-auth secondaryStorage] delete failed:', error);
      }
    },
    get: async (key: string) => {
      try {
        const redisClient = await getRedisClient();
        if (!redisClient) return null;
        return (await redisClient.get(buildKey(key))) ?? null;
      } catch (error) {
        console.error('[better-auth secondaryStorage] get failed:', error);
        return null;
      }
    },
    set: async (key: string, value: string, ttl?: number) => {
      try {
        const redisClient = await getRedisClient();
        if (!redisClient) return;
        if (typeof ttl === 'number') {
          await redisClient.set(buildKey(key), value, { ex: ttl });
          return;
        }
        await redisClient.set(buildKey(key), value);
      } catch (error) {
        console.error('[better-auth secondaryStorage] set failed:', error);
      }
    },
  };
};
