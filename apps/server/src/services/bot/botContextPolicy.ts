import { defaultInheritContextPolicy } from '@lobechat/agent-runtime';

/** Inactivity window before a DingTalk / IM bot operation is considered stuck. */
export const BOT_DEADLINE_MS = 12 * 60 * 1000;

/**
 * Bot/IM runs use the same inherited tools, skills, history, and context
 * budgets as the Web agent runtime. Channel adapters are transport layers;
 * they must not silently lower answer quality by giving the model a smaller
 * conversation or tool-result window.
 */
export const botContextPolicy = defaultInheritContextPolicy();
