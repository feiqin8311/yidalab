/** Conservative per-message limit for DingTalk Markdown robot messages. */
export const DINGTALK_MARKDOWN_CHAR_LIMIT = 3500;

/** Keep proactive DM routing metadata long enough to outlive session webhooks. */
export const DINGTALK_DELIVERY_TARGET_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Bound no-Redis development fallback state so long-lived processes cannot grow forever. */
export const DINGTALK_FALLBACK_CACHE_MAX_ENTRIES = 1000;
