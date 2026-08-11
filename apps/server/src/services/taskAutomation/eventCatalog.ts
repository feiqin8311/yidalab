import type { TaskProductEventType } from '@lobechat/types';

/**
 * Product event catalog → internal Agent Signal sourceType mapping.
 * UI / task config only store product keys; Signal protocol can change freely.
 */
export const PRODUCT_EVENT_TO_SIGNAL: Record<TaskProductEventType, string[]> = {
  agent_run_completed: ['agent.execution.completed'],
  agent_run_failed: ['agent.execution.failed'],
  bot_message_received: ['bot.message.merged'],
  tool_run_completed: ['tool.outcome.completed'],
  tool_run_failed: ['tool.outcome.failed'],
};

export const SIGNAL_TO_PRODUCT_EVENT: Record<string, TaskProductEventType> = Object.fromEntries(
  (Object.entries(PRODUCT_EVENT_TO_SIGNAL) as [TaskProductEventType, string[]][]).flatMap(
    ([product, signals]) => signals.map((s) => [s, product]),
  ),
) as Record<string, TaskProductEventType>;

export const isProductEventType = (v: string): v is TaskProductEventType =>
  v in PRODUCT_EVENT_TO_SIGNAL;

/** Whitelisted filter fields for product events (no free JSON path). */
export const PRODUCT_EVENT_FILTER_FIELDS: Record<TaskProductEventType, string[]> = {
  agent_run_completed: ['agentId', 'taskId', 'status'],
  agent_run_failed: ['agentId', 'taskId', 'status'],
  bot_message_received: ['platform', 'applicationId'],
  tool_run_completed: ['toolName', 'identifier'],
  tool_run_failed: ['toolName', 'identifier'],
};

export function mapSignalToProductEvent(sourceType: string): TaskProductEventType | null {
  return SIGNAL_TO_PRODUCT_EVENT[sourceType] ?? null;
}
