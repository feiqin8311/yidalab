/**
 * Per-turn isolation boundary for bot attachment analysis + dingpan delivery.
 * topicId is session ownership only — never the deliverable scope.
 */
export interface BotTurnContext {
  assistantMessageId?: string;
  operationId: string;
  sourceMessageId?: string;
  startedAt?: Date;
  topicId?: string | null;
}
