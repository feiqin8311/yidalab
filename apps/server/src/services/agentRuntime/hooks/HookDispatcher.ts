import debug from 'debug';
import urlJoin from 'url-join';

import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

import type {
  AgentHook,
  AgentHookEvent,
  AgentHookType,
  AgentHookWebhook,
  AnyHookEvent,
  SerializedHook,
  ToolCallHookEvent,
} from './types';

const log = debug('lobe-server:hook-dispatcher');

/**
 * Delivers a webhook via HTTP POST (fetch or QStash)
 */
export async function deliverWebhook(
  webhook: AgentHookWebhook,
  payload: Record<string, unknown>,
): Promise<void> {
  const { url, delivery = 'fetch', fallback = 'fetch' } = webhook;

  // Resolve URL: relative paths joined with INTERNAL_APP_URL or APP_URL
  const resolvedUrl = url.startsWith('http')
    ? url
    : urlJoin(process.env.INTERNAL_APP_URL || process.env.APP_URL || '', url);

  // Bot completion must survive local-queue mode and process restart: always
  // enqueue the durable job, even when the serialized hook used delivery=fetch.
  if (url.includes('/api/agent/webhooks/bot-callback')) {
    try {
      const { enqueueInternalJob } = await import('@/server/services/internalJob/enqueue');
      const { JOB_NAMES } = await import('@/server/services/internalJob/types');
      const operationId = typeof payload.operationId === 'string' ? payload.operationId : undefined;
      await enqueueInternalJob({
        dedupeKey: operationId ? `bot-completion:${operationId}` : undefined,
        name: JOB_NAMES.botCompletion,
        payload,
      });
      log('Webhook delivered via internal job (bot): %s', url);
      return;
    } catch (error) {
      if (fallback === 'none') throw error;
      log('Internal job delivery failed, falling back to fetch: %O', error);
      await fetchDeliver(resolvedUrl, payload);
      return;
    }
  }

  if (delivery === 'qstash') {
    // Prefer internal Redis jobs (replaces QStash). Known workflow paths map to job names.
    try {
      const { enqueueInternalJob } = await import('@/server/services/internalJob/enqueue');
      const { JOB_NAMES } = await import('@/server/services/internalJob/types');
      if (url.includes('/api/workflows/verify/on-verifier-complete')) {
        await enqueueInternalJob({ name: JOB_NAMES.verifyComplete, payload });
        log('Webhook delivered via internal job (verify): %s', url);
        return;
      }
      if (url.includes('/api/workflows/operations-function/on-complete')) {
        await enqueueInternalJob({ name: JOB_NAMES.opsFunctionComplete, payload });
        log('Webhook delivered via internal job (ops): %s', url);
        return;
      }
      // Generic deferred delivery still needs a worker path; unsigned fetch is only
      // allowed when fallback permits it (control-flow hooks use fallback: 'none').
      if (fallback === 'none') {
        throw new Error(`QSTASH_TOKEN not available for unsigned-unsafe webhook path: ${url}`);
      }
      log('Unknown qstash webhook path, using fetch: %s', url);
      await fetchDeliver(resolvedUrl, payload);
    } catch (error) {
      if (fallback === 'none') throw error;
      log('Internal job delivery failed, falling back to fetch: %O', error);
      await fetchDeliver(resolvedUrl, payload);
    }
  } else {
    await fetchDeliver(resolvedUrl, payload);
  }
}

async function fetchDeliver(url: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(url, {
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    log('Webhook delivered via fetch: %s (status: %d)', url, res.status);
  } catch (error) {
    log('Webhook fetch delivery failed: %s %O', url, error);
    // Hook errors should not affect main flow
  }
}

function buildWebhookPayload(
  event: AnyHookEvent,
  eventFields?: (keyof AgentHookEvent)[],
): Record<string, unknown> {
  if (eventFields) {
    const payload: Record<string, unknown> = {};
    for (const field of eventFields) {
      if (field === 'finalState') continue;
      if (field in event) payload[field] = event[field as keyof AnyHookEvent];
    }
    return payload;
  }

  const payload = { ...event };
  if ('finalState' in payload) {
    delete (payload as { finalState?: unknown }).finalState;
  }
  return payload;
}

/**
 * HookDispatcher — central hub for registering and dispatching agent lifecycle hooks
 *
 * Local mode: hooks are stored in memory, handler functions called directly
 * Production mode: webhook configs persisted in AgentState.metadata._hooks,
 *   delivered via HTTP POST or QStash
 */
export class HookDispatcher {
  /**
   * In-memory hook store (local mode)
   * Maps operationId → AgentHook[]
   */
  private hooks: Map<string, AgentHook[]> = new Map();

  /**
   * Dispatch hooks for a given event type
   *
   * In local mode: calls handler functions from memory
   * In production mode: delivers webhooks from serialized config
   */
  async dispatch(
    operationId: string,
    type: AgentHookType,
    event: AnyHookEvent,
    serializedHooks?: SerializedHook[],
  ): Promise<void> {
    const isQueueMode = isQueueAgentRuntimeEnabled();

    // Local in-memory handlers win when this process still holds them.
    // Serialized webhooks are only a restart/abandon fallback — firing them
    // first would skip Eval / ops / sub-agent local completion handlers.
    const localHooks = this.hooks.get(operationId)?.filter((h) => h.type === type) || [];
    if (!isQueueMode && localHooks.length > 0) {
      for (const hook of localHooks) {
        try {
          log('[%s][%s] Dispatching local hook: %s', operationId, type, hook.id);
          await hook.handler(event as AgentHookEvent);
        } catch (error) {
          log('[%s][%s] Hook error (non-fatal): %s %O', operationId, type, hook.id, error);
          // Hook errors should NOT affect main execution flow
        }
      }
    } else {
      // Production mode: deliver via webhooks
      const webhookHooks =
        serializedHooks?.filter((h) => h.type === type && h.webhook) ||
        this.getSerializedHooks(operationId)?.filter((h) => h.type === type) ||
        [];

      for (const hook of webhookHooks) {
        try {
          log(
            '[%s][%s] Delivering webhook hook: %s → %s',
            operationId,
            type,
            hook.id,
            hook.webhook.url,
          );
          const webhookPayload = buildWebhookPayload(event, hook.webhook.eventFields);
          await deliverWebhook(hook.webhook, {
            ...webhookPayload,
            hookId: hook.id,
            hookType: type,
            ...hook.webhook.body,
          });
        } catch (error) {
          if (hook.webhook.fallback === 'none') {
            // No-fallback webhooks carry control flow (e.g. the sub-agent
            // resume bridge) — losing one strands its consumer, so surface
            // the failure in production logs, not just the debug namespace.
            console.error(
              `[HookDispatcher][${operationId}][${type}] Webhook delivery failed with no fallback: ${hook.id} → ${hook.webhook.url}`,
              error,
            );
          } else {
            log(
              '[%s][%s] Webhook delivery error (non-fatal): %s %O',
              operationId,
              type,
              hook.id,
              error,
            );
          }
        }
      }
    }
  }

  /**
   * Dispatch beforeToolCall hooks with mock support.
   * Returns mock result if any handler called event.mock(), otherwise null.
   */
  async dispatchBeforeToolCall(
    operationId: string,
    event: Omit<ToolCallHookEvent, 'mock' | 'operationId'>,
  ): Promise<{ content: string; isMocked: true } | null> {
    const hooks = this.hooks.get(operationId)?.filter((h) => h.type === 'beforeToolCall') || [];
    if (hooks.length === 0) return null;

    let isMocked = false;
    let mockedContent = '';

    const toolCallEvent: ToolCallHookEvent = {
      ...event,
      mock: (result) => {
        // Only accept non-empty string content
        if (typeof result?.content === 'string' && result.content.length > 0) {
          isMocked = true;
          mockedContent = result.content;
        } else {
          log(
            '[%s][beforeToolCall] mock() called with invalid content (must be non-empty string), ignoring',
            operationId,
          );
        }
      },
      operationId,
    };

    for (const hook of hooks) {
      try {
        log('[%s][beforeToolCall] Dispatching: %s', operationId, hook.id);
        await hook.handler(toolCallEvent as any);
      } catch (error) {
        log('[%s][beforeToolCall] Hook error (non-fatal): %s %O', operationId, hook.id, error);
      }
    }

    return isMocked ? { content: mockedContent, isMocked: true } : null;
  }

  /**
   * Get serialized hooks for an operation (for production mode persistence)
   */
  getSerializedHooks(operationId: string): SerializedHook[] | undefined {
    const hooks = this.hooks.get(operationId);
    if (!hooks) return undefined;

    return hooks
      .filter((h) => h.webhook)
      .map((h) => ({
        id: h.id,
        type: h.type,
        webhook: h.webhook!,
      }));
  }

  /**
   * Check if any hooks are registered for an operation
   */
  hasHooks(operationId: string): boolean {
    return (this.hooks.get(operationId)?.length ?? 0) > 0;
  }

  /**
   * Register hooks for an operation
   *
   * In local mode: stores hooks in memory (including handler functions)
   * In production mode: caller should persist getSerializedHooks() to state.metadata._hooks
   */
  register(operationId: string, hooks: AgentHook[]): void {
    if (hooks.length === 0) return;

    const existing = this.hooks.get(operationId) || [];
    this.hooks.set(operationId, [...existing, ...hooks]);

    log(
      '[%s] Registered %d hooks: %s',
      operationId,
      hooks.length,
      hooks.map((h) => `${h.type}:${h.id}`).join(', '),
    );
  }

  /**
   * Unregister all hooks for an operation (cleanup)
   */
  unregister(operationId: string): void {
    this.hooks.delete(operationId);
    log('[%s] Unregistered all hooks', operationId);
  }
}

/**
 * Singleton instance — shared across the application
 */
export const hookDispatcher = new HookDispatcher();
