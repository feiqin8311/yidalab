/**
 * Legacy → target protocol mapping.
 *
 * PR1 rules:
 * - Define the mapping matrix and pure helpers only.
 * - Do NOT re-declare AgentStreamEvent (gateway-client remains wire SSOT).
 * - Do NOT change runtime behavior or wire producers/consumers.
 * - sequence is always minted (required on target events). Adapters may use
 *   createSequenceAllocator() for a single mapping session; Journal later
 *   becomes the authority.
 *
 * Two legacy dialects exist today:
 * 1. Engine `AgentEvent` — packages/agent-runtime/src/types/event.ts
 * 2. Wire `AgentStreamEvent` — packages/agent-gateway-client/src/types.ts
 */

import type { AgentEvent, FinishReason } from '../types/event';
import type { AgentRuntimeCommand } from './commands';
import type {
  AgentRuntimeEvent,
  InterventionRequestedEvent,
  ItemCompletedEvent,
  ItemDeltaEvent,
  ItemKind,
  ItemStartedEvent,
  OperationCompletedEvent,
  OperationFailedEvent,
  OperationInterruptedEvent,
  OperationStartedEvent,
  TurnCompletedEvent,
  TurnStartedEvent,
} from './events';
import type { EventId, OperationId, Sequence, StepId, TurnId } from './ids';
import {
  approvalInterventionId,
  promptInterventionId,
  selectionInterventionId,
} from './interventionIds';
import type { ItemEventMeta, OperationEventMeta, TurnEventMeta } from './scopes';

// ─── Sequence allocator (session-local; Journal replaces later) ───

export interface SequenceAllocator {
  /** Last issued sequence (0 if none). */
  readonly current: Sequence;
  /** Next monotonic sequence for this operation mapping session. */
  next: () => Sequence;
}

/** Mint monotonic sequences for one mapping session (not durable). */
export function createSequenceAllocator(startAfter: Sequence = 0): SequenceAllocator {
  let current = startAfter;
  return {
    get current() {
      return current;
    },
    next() {
      current += 1;
      return current;
    },
  };
}

// ─── Mapping context ───

export interface LegacyMappingContext {
  /**
   * Event id factory. Prefer stable wire/Redis ids when available so reconnect
   * can dedupe. Defaults to `${operationId}:${sequence}`.
   */
  eventId?: (sequence: Sequence) => EventId;
  /** Wall-clock override (tests). Defaults to Date.now(). */
  now?: () => number;
  operationId: OperationId;
  /**
   * Session-local sequence source. For durable multi-instance authority use
   * PostgresOperationJournal.appendControlEvent (atomic DB sequence) instead.
   */
  sequences: SequenceAllocator;
  stepId?: StepId;
  /** Optional fixed turn/step when the legacy source has no turn concept. */
  turnId?: TurnId;
  /**
   * Stable wire event id (e.g. Redis stream entry id). When set, used as
   * eventId base for mapped events from that wire frame — independent of
   * process-local sequence (survives restart / replay).
   */
  wireEventId?: string;
}

function defaultEventId(operationId: OperationId, sequence: Sequence): EventId {
  return `${operationId}:${sequence}`;
}

/**
 * Stable eventId for journal dedupe.
 *
 * - With wireEventId (Redis stream entry id): use wire id alone for 1:1 frames;
 *   when one frame expands to multiple protocol events, append a frame-local
 *   ordinal (`:0`, `:1`, …) — NEVER the process-local operation sequence
 *   (that restarts after process restart and breaks journal dedupe).
 * - Without wire id: fall back to operationId:sequence (session-local only).
 */
function resolveEventId(
  ctx: LegacyMappingContext,
  sequence: Sequence,
  frameOrdinal?: number,
): EventId {
  if (ctx.wireEventId) {
    if (frameOrdinal === undefined || frameOrdinal === 0) {
      // Single-event frames: bare wire id is enough and fully stable.
      // Multi-event frames pass frameOrdinal starting at 0 for the first.
      return frameOrdinal === undefined ? ctx.wireEventId : `${ctx.wireEventId}:0`;
    }
    return `${ctx.wireEventId}:${frameOrdinal}`;
  }
  return ctx.eventId?.(sequence) ?? defaultEventId(ctx.operationId, sequence);
}

function operationMeta(ctx: LegacyMappingContext, frameOrdinal?: number): OperationEventMeta {
  const sequence = ctx.sequences.next();
  const timestamp = (ctx.now ?? Date.now)();
  return {
    eventId: resolveEventId(ctx, sequence, frameOrdinal),
    operationId: ctx.operationId,
    sequence,
    timestamp,
  };
}

function turnMeta(ctx: LegacyMappingContext, turnId: TurnId, frameOrdinal?: number): TurnEventMeta {
  const sequence = ctx.sequences.next();
  const timestamp = (ctx.now ?? Date.now)();
  return {
    eventId: resolveEventId(ctx, sequence, frameOrdinal),
    operationId: ctx.operationId,
    sequence,
    timestamp,
    turnId,
  };
}

function itemMeta(
  ctx: LegacyMappingContext,
  turnId: TurnId,
  stepId: StepId,
  itemId?: string,
  frameOrdinal?: number,
): ItemEventMeta {
  const sequence = ctx.sequences.next();
  const timestamp = (ctx.now ?? Date.now)();
  return {
    eventId: resolveEventId(ctx, sequence, frameOrdinal),
    itemId,
    operationId: ctx.operationId,
    sequence,
    stepId,
    timestamp,
    turnId,
  };
}

function fallbackTurnId(ctx: LegacyMappingContext): TurnId {
  return ctx.turnId ?? `turn:${ctx.operationId}`;
}

function fallbackStepId(ctx: LegacyMappingContext, hint?: string | number): StepId {
  if (ctx.stepId) return ctx.stepId;
  if (hint !== undefined) return `step:${hint}`;
  return `step:${ctx.sequences.current + 1}`;
}

// ─── Mapping fidelity ───

export type MappingFidelity = 'lossless' | 'lossy' | 'unmapped';

export interface MappingNote {
  fidelity: MappingFidelity;
  /**
   * Fields that cannot be reconstructed losslessly from the legacy shape,
   * or semantics that differ.
   */
  lossyFields?: string[];
  notes?: string;
  /** Legacy discriminator (engine type or wire type). */
  source: string;
  /** Target event type(s), empty when unmapped. */
  target: AgentRuntimeEvent['type'][];
}

// ─── Engine AgentEvent → target ───

/**
 * Matrix: engine AgentEvent → AgentRuntimeEvent.
 *
 * Engine events are step-result signals from AgentRuntime.step(), not the
 * live wire stream. Many lack turn/step identity; adapters synthesize ids.
 */
export const ENGINE_EVENT_MAPPING: readonly MappingNote[] = [
  {
    fidelity: 'lossy',
    lossyFields: ['turnId', 'stepId', 'sequence'],
    notes: 'Maps to operation_started. No wire counterpart on client path.',
    source: 'init',
    target: ['operation_started'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['turnId', 'stepId', 'itemId', 'sequence'],
    notes: 'Maps to item_started(kind=assistant_message). payload is opaque.',
    source: 'llm_start',
    target: ['item_started'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['turnId', 'stepId', 'itemId', 'sequence', 'chunk shape'],
    notes: 'Maps to item_delta. Engine chunk is unknown-shaped.',
    source: 'llm_stream',
    target: ['item_delta'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['turnId', 'stepId', 'itemId', 'sequence'],
    notes: 'Maps to item_completed(kind=assistant_message).',
    source: 'llm_result',
    target: ['item_completed'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['turnId', 'stepId', 'itemId', 'sequence'],
    notes:
      'Maps to item_delta with retry metadata in delta; no dedicated retry event in v1 protocol.',
    source: 'stream_retry',
    target: ['item_delta'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['turnId', 'stepId', 'itemId', 'sequence', 'per-call item split'],
    notes: 'One item_started(kind=tool_call) per batch; not split per tool call.',
    source: 'tool_pending',
    target: ['item_started'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['turnId', 'stepId', 'sequence'],
    notes: 'Maps to item_completed(kind=tool_result); engine id → itemId when present.',
    source: 'tool_result',
    target: ['item_completed'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['turnId', 'stepId', 'sequence'],
    notes:
      'One intervention_requested per tool call (per-tool approval SSOT). interventionId = approve:${toolCallId}.',
    source: 'human_approve_required',
    target: ['intervention_requested'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['turnId', 'stepId', 'sequence'],
    notes: 'Maps to intervention_requested(kind=input). interventionId = prompt:${operationId}.',
    source: 'human_prompt_required',
    target: ['intervention_requested'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['turnId', 'stepId', 'sequence'],
    notes:
      'Maps to intervention_requested(kind=selection). interventionId = select:${operationId}.',
    source: 'human_select_required',
    target: ['intervention_requested'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['finalState', 'sequence'],
    notes: 'Maps to operation_completed. finalState is product projection, not protocol.',
    source: 'done',
    target: ['operation_completed'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['sequence'],
    notes: 'Maps to operation_failed.',
    source: 'error',
    target: ['operation_failed'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['interruptedInstruction', 'sequence'],
    notes: 'Maps to operation_interrupted (recoverable). Not operation_failed.',
    source: 'interrupted',
    target: ['operation_interrupted'],
  },
  {
    fidelity: 'unmapped',
    notes:
      'Execution resume is a Command (resume_operation), not an Event. Engine resumed is dropped at event layer.',
    source: 'resumed',
    target: [],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['turnId', 'stepId', 'sequence'],
    notes: 'Maps to item_completed(kind=compression).',
    source: 'compression_complete',
    target: ['item_completed'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['turnId', 'stepId', 'sequence'],
    notes: 'Maps to item_completed(kind=compression, isSuccess=false).',
    source: 'compression_error',
    target: ['item_completed'],
  },
] as const;

/**
 * Map one engine AgentEvent into zero or more target protocol events.
 * Always assigns a fresh sequence via ctx.sequences.
 */
export function mapEngineEvent(event: AgentEvent, ctx: LegacyMappingContext): AgentRuntimeEvent[] {
  const turnId = fallbackTurnId(ctx);
  const stepId = fallbackStepId(ctx);

  switch (event.type) {
    case 'init': {
      const out: OperationStartedEvent = {
        type: 'operation_started',
        meta: operationMeta(ctx),
      };
      return [out];
    }
    case 'llm_start': {
      const out: ItemStartedEvent = {
        type: 'item_started',
        meta: itemMeta(ctx, turnId, stepId),
        payload: { kind: 'assistant_message', data: event.payload },
      };
      return [out];
    }
    case 'llm_stream': {
      const out: ItemDeltaEvent = {
        type: 'item_delta',
        meta: itemMeta(ctx, turnId, stepId),
        payload: { kind: 'assistant_message', delta: event.chunk },
      };
      return [out];
    }
    case 'llm_result': {
      const out: ItemCompletedEvent = {
        type: 'item_completed',
        meta: itemMeta(ctx, turnId, stepId),
        payload: { kind: 'assistant_message', data: event.result },
      };
      return [out];
    }
    case 'stream_retry': {
      const out: ItemDeltaEvent = {
        type: 'item_delta',
        meta: itemMeta(ctx, turnId, stepId),
        payload: { kind: 'unknown', delta: { retry: event.data } },
      };
      return [out];
    }
    case 'tool_pending': {
      const out: ItemStartedEvent = {
        type: 'item_started',
        meta: itemMeta(ctx, turnId, stepId),
        payload: { kind: 'tool_call', data: { toolCalls: event.toolCalls } },
      };
      return [out];
    }
    case 'tool_result': {
      const out: ItemCompletedEvent = {
        type: 'item_completed',
        meta: itemMeta(ctx, turnId, stepId, event.id),
        payload: { kind: 'tool_result', data: event.result },
      };
      return [out];
    }
    case 'human_approve_required': {
      // Per-tool approval: one intervention event per pending tool call.
      const tools = event.pendingToolsCalling ?? [];
      if (tools.length === 0) {
        const out: InterventionRequestedEvent = {
          type: 'intervention_requested',
          meta: itemMeta(ctx, turnId, stepId),
          payload: {
            interventionId: approvalInterventionId(`batch:${event.operationId}`),
            kind: 'approval',
            request: { pendingToolsCalling: tools },
          },
        };
        return [out];
      }
      return tools.map((tool) => {
        const toolCallId = tool.id || `unknown:${event.operationId}`;
        const out: InterventionRequestedEvent = {
          type: 'intervention_requested',
          meta: itemMeta(ctx, turnId, stepId, toolCallId),
          payload: {
            interventionId: approvalInterventionId(toolCallId),
            kind: 'approval',
            request: { pendingToolsCalling: [tool], tool },
          },
        };
        return out;
      });
    }
    case 'human_prompt_required': {
      const out: InterventionRequestedEvent = {
        type: 'intervention_requested',
        meta: itemMeta(ctx, turnId, stepId),
        payload: {
          interventionId: promptInterventionId(event.operationId),
          kind: 'input',
          request: { prompt: event.prompt, metadata: event.metadata },
        },
      };
      return [out];
    }
    case 'human_select_required': {
      const out: InterventionRequestedEvent = {
        type: 'intervention_requested',
        meta: itemMeta(ctx, turnId, stepId),
        payload: {
          interventionId: selectionInterventionId(event.operationId),
          kind: 'selection',
          request: {
            multi: event.multi,
            options: event.options,
            prompt: event.prompt,
            metadata: event.metadata,
          },
        },
      };
      return [out];
    }
    case 'done': {
      const out: OperationCompletedEvent = {
        type: 'operation_completed',
        meta: operationMeta(ctx),
        payload: {
          reason: event.reason satisfies FinishReason as string,
          reasonDetail: event.reasonDetail,
        },
      };
      return [out];
    }
    case 'error': {
      const out: OperationFailedEvent = {
        type: 'operation_failed',
        meta: operationMeta(ctx),
        payload: { error: event.error },
      };
      return [out];
    }
    case 'interrupted': {
      const out: OperationInterruptedEvent = {
        type: 'operation_interrupted',
        meta: operationMeta(ctx),
        payload: {
          canResume: event.canResume,
          reason: event.reason,
          interruptedAt: event.interruptedAt,
          metadata: event.metadata,
        },
      };
      return [out];
    }
    case 'resumed': {
      // Execution resume is a Command, not an Event.
      return [];
    }
    case 'compression_complete': {
      const out: ItemCompletedEvent = {
        type: 'item_completed',
        meta: itemMeta(ctx, turnId, stepId),
        payload: {
          kind: 'compression',
          data: { groupId: event.groupId, parentMessageId: event.parentMessageId },
          isSuccess: true,
        },
      };
      return [out];
    }
    case 'compression_error': {
      const out: ItemCompletedEvent = {
        type: 'item_completed',
        meta: itemMeta(ctx, turnId, stepId),
        payload: { kind: 'compression', data: { error: event.error }, isSuccess: false },
      };
      return [out];
    }
    default: {
      // Exhaustiveness: if a new AgentEvent is added, TS should fail here.
      const _exhaustive: never = event;
      void _exhaustive;
      return [];
    }
  }
}

// ─── Wire AgentStreamEvent → target (structural; no third SSOT) ───

/**
 * Wire type names for mapping matrix / docs.
 * SSOT for the wire union is packages/agent-gateway-client/src/types.ts
 * (AgentStreamEventType). This list is documentation for WIRE_EVENT_MAPPING
 * only — mapWireEvent exhausts known cases and returns [] for unknowns.
 *
 * When gateway adds a type: update AgentStreamEventType first, then add a
 * matrix row + switch case here (or explicitly leave unmapped).
 */
export const KNOWN_WIRE_EVENT_TYPES = [
  'agent_runtime_init',
  'agent_runtime_end',
  'stream_start',
  'stream_chunk',
  'stream_end',
  'visible_output_end',
  'stream_retry',
  'tool_start',
  'tool_end',
  'tool_execute',
  'tool_result',
  'agent_intervention_request',
  'agent_intervention_response',
  'step_start',
  'step_complete',
  'notify_update',
  'error',
] as const;

export type KnownWireEventType = (typeof KNOWN_WIRE_EVENT_TYPES)[number];

/**
 * Structural wire event shape used only as mapping *input*.
 * Call sites should pass AgentStreamEvent values; structural typing accepts them.
 * Prefer KnownWireEventType; unknown strings map to [] (no silent journal pollution).
 */
export interface LegacyWireEventInput {
  data?: unknown;
  /** Redis stream entry id — preferred stable eventId source. */
  id?: string;
  operationId: string;
  stepIndex: number;
  timestamp: number;
  type: KnownWireEventType | (string & {});
}

/**
 * Matrix: wire AgentStreamEventType → AgentRuntimeEvent.
 *
 * Lossy fields called out explicitly — do not pretend wire is a 1:1 rename.
 */
export const WIRE_EVENT_MAPPING: readonly MappingNote[] = [
  {
    fidelity: 'lossy',
    lossyFields: ['sequence (minted)', 'turnId (synthesized)'],
    source: 'agent_runtime_init',
    target: ['operation_started'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['sequence', 'reason mapping from data'],
    source: 'agent_runtime_end',
    target: ['operation_completed'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['sequence', 'turnId', 'stepId', 'itemId'],
    notes: 'stream_start → item_started(assistant_message).',
    source: 'stream_start',
    target: ['item_started'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['sequence', 'turnId', 'stepId', 'itemId', 'chunkType taxonomy'],
    source: 'stream_chunk',
    target: ['item_delta'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['sequence', 'turnId', 'stepId', 'itemId'],
    source: 'stream_end',
    target: ['item_completed'],
  },
  {
    fidelity: 'unmapped',
    notes:
      'visible_output_end is a producer boundary with no v1 target counterpart; drop until protocol grows a visibility event.',
    source: 'visible_output_end',
    target: [],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['sequence', 'turnId', 'stepId'],
    notes: 'Folded into item_delta retry metadata.',
    source: 'stream_retry',
    target: ['item_delta'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['sequence', 'turnId', 'stepId', 'itemId'],
    source: 'tool_start',
    target: ['item_started'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['sequence', 'turnId', 'stepId', 'itemId'],
    source: 'tool_end',
    target: ['item_completed'],
  },
  {
    fidelity: 'unmapped',
    notes:
      'tool_execute is a reverse RPC (server→client run tool), not a lifecycle event. Becomes a Command or side-channel in a later PR.',
    source: 'tool_execute',
    target: [],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['sequence', 'turnId', 'stepId', 'itemId'],
    notes: 'Hetero producer tool_result content.',
    source: 'tool_result',
    target: ['item_completed'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['sequence', 'turnId', 'stepId', 'interventionId (from toolCallId)'],
    source: 'agent_intervention_request',
    target: ['intervention_requested'],
  },
  {
    fidelity: 'unmapped',
    notes:
      'agent_intervention_response is a Command direction (resolve_intervention), not an Event.',
    source: 'agent_intervention_response',
    target: [],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['sequence', 'turnId (from stepIndex)'],
    source: 'step_start',
    target: ['turn_started'],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['sequence', 'turnId (from stepIndex)'],
    source: 'step_complete',
    target: ['turn_completed'],
  },
  {
    fidelity: 'unmapped',
    notes: 'notify_update is a product invalidation signal, not agent lifecycle.',
    source: 'notify_update',
    target: [],
  },
  {
    fidelity: 'lossy',
    lossyFields: ['sequence'],
    source: 'error',
    target: ['operation_failed'],
  },
] as const;

function wireTurnId(event: LegacyWireEventInput, ctx: LegacyMappingContext): TurnId {
  return ctx.turnId ?? `turn:${event.operationId}:${event.stepIndex}`;
}

function wireStepId(event: LegacyWireEventInput, ctx: LegacyMappingContext): StepId {
  return ctx.stepId ?? `step:${event.stepIndex}`;
}

function chunkKind(data: unknown): ItemKind {
  if (data && typeof data === 'object' && 'chunkType' in data) {
    const chunkType = (data as { chunkType?: string }).chunkType;
    if (chunkType === 'reasoning' || chunkType === 'reasoning_part') return 'reasoning';
    if (chunkType === 'tools_calling') return 'tool_call';
    if (chunkType === 'text' || chunkType === 'content_part') return 'assistant_message';
  }
  return 'unknown';
}

/**
 * Map one wire stream event into zero or more target protocol events.
 * Accepts AgentStreamEvent by structural typing — does not import gateway-client.
 */
export function mapWireEvent(
  event: LegacyWireEventInput,
  ctx: LegacyMappingContext,
): AgentRuntimeEvent[] {
  // Prefer the event's own operationId when present (multi-op demux).
  // Prefer Redis stream id as stable eventId for dedupe across reconnect.
  const opCtx: LegacyMappingContext = {
    ...ctx,
    operationId:
      event.operationId && event.operationId !== ctx.operationId
        ? event.operationId
        : ctx.operationId,
    wireEventId: event.id ?? ctx.wireEventId,
  };

  const turnId = wireTurnId(event, opCtx);
  const stepId = wireStepId(event, opCtx);
  const ts = event.timestamp || undefined;

  // Use wire timestamp when provided by overriding now once per event.
  const timedCtx: LegacyMappingContext = ts ? { ...opCtx, now: () => ts } : opCtx;

  switch (event.type) {
    case 'agent_runtime_init': {
      const out: OperationStartedEvent = {
        type: 'operation_started',
        meta: operationMeta(timedCtx),
        payload: event.data as OperationStartedEvent['payload'],
      };
      return [out];
    }
    case 'agent_runtime_end': {
      const data = (event.data ?? {}) as { reason?: string; reasonDetail?: string };
      const out: OperationCompletedEvent = {
        type: 'operation_completed',
        meta: operationMeta(timedCtx),
        payload: {
          reason: data.reason ?? 'completed',
          reasonDetail: data.reasonDetail,
        },
      };
      return [out];
    }
    case 'stream_start': {
      const out: ItemStartedEvent = {
        type: 'item_started',
        meta: itemMeta(timedCtx, turnId, stepId),
        payload: { kind: 'assistant_message', data: event.data },
      };
      return [out];
    }
    case 'stream_chunk': {
      const out: ItemDeltaEvent = {
        type: 'item_delta',
        meta: itemMeta(timedCtx, turnId, stepId),
        payload: { kind: chunkKind(event.data), delta: event.data },
      };
      return [out];
    }
    case 'stream_end': {
      const out: ItemCompletedEvent = {
        type: 'item_completed',
        meta: itemMeta(timedCtx, turnId, stepId),
        payload: { kind: 'assistant_message', data: event.data },
      };
      return [out];
    }
    case 'stream_retry': {
      const out: ItemDeltaEvent = {
        type: 'item_delta',
        meta: itemMeta(timedCtx, turnId, stepId),
        payload: { kind: 'unknown', delta: { retry: event.data } },
      };
      return [out];
    }
    case 'tool_start': {
      const out: ItemStartedEvent = {
        type: 'item_started',
        meta: itemMeta(timedCtx, turnId, stepId),
        payload: { kind: 'tool_call', data: event.data },
      };
      return [out];
    }
    case 'tool_end': {
      const data = (event.data ?? {}) as { isSuccess?: boolean };
      const out: ItemCompletedEvent = {
        type: 'item_completed',
        meta: itemMeta(timedCtx, turnId, stepId),
        payload: {
          kind: 'tool_result',
          data: event.data,
          isSuccess: data.isSuccess,
        },
      };
      return [out];
    }
    case 'tool_result': {
      const out: ItemCompletedEvent = {
        type: 'item_completed',
        meta: itemMeta(timedCtx, turnId, stepId),
        payload: { kind: 'tool_result', data: event.data },
      };
      return [out];
    }
    case 'agent_intervention_request': {
      const data = (event.data ?? {}) as { toolCallId?: string };
      const out: InterventionRequestedEvent = {
        type: 'intervention_requested',
        meta: itemMeta(timedCtx, turnId, stepId, data.toolCallId),
        payload: {
          interventionId: data.toolCallId ?? `intervention:${event.operationId}:${event.stepIndex}`,
          kind: 'input',
          request: event.data,
        },
      };
      return [out];
    }
    case 'step_start': {
      const out: TurnStartedEvent = {
        type: 'turn_started',
        meta: turnMeta(timedCtx, turnId),
        payload: { stepIndex: event.stepIndex },
      };
      return [out];
    }
    case 'step_complete': {
      const data = (event.data ?? {}) as {
        phase?: string;
        reason?: string;
        reasonDetail?: string;
      };
      const out: TurnCompletedEvent = {
        type: 'turn_completed',
        meta: turnMeta(timedCtx, turnId),
        payload: {
          phase: data.phase,
          reason: data.reason,
          reasonDetail: data.reasonDetail,
          stepIndex: event.stepIndex,
        },
      };
      return [out];
    }
    case 'error': {
      const out: OperationFailedEvent = {
        type: 'operation_failed',
        meta: operationMeta(timedCtx),
        payload: { error: event.data },
      };
      return [out];
    }
    case 'visible_output_end':
    case 'tool_execute':
    case 'agent_intervention_response':
    case 'notify_update': {
      return [];
    }
    default: {
      return [];
    }
  }
}

// ─── Command direction notes (documentation matrix) ───

/**
 * How today's product/WS inputs map toward AgentRuntimeCommand.
 * Not executable adapters — orientation for PR2+.
 */
export const LEGACY_COMMAND_MAPPING: readonly {
  legacy: string;
  target: AgentRuntimeCommand['type'] | null;
  notes: string;
}[] = [
  {
    legacy: 'ExecAgentTaskParams (fresh prompt)',
    notes: 'Product start; input stays opaque in v1.',
    target: 'start_operation',
  },
  {
    legacy: 'ExecAgentTaskParams.resumeApproval',
    notes: 'reason=after_approval; payload carries decision + toolCallId.',
    target: 'resume_operation',
  },
  {
    legacy: 'ExecAgentTaskParams.resumeToolResult',
    notes: 'reason=after_tool_result; does not re-execute the tool.',
    target: 'resume_operation',
  },
  {
    legacy: 'InterruptTaskParams / WS InterruptMessage',
    notes: 'Path-specific today; unify on interrupt_operation.',
    target: 'interrupt_operation',
  },
  {
    legacy: 'WS ResumeMessage { lastEventId }',
    notes:
      'TRANSPORT reconnect only. Maps to subscribe_operation — NEVER resume_operation. afterSequence derived from lastEventId once Journal exists.',
    target: 'subscribe_operation',
  },
  {
    legacy: 'WS ToolResultMessage',
    notes:
      'Client-local tool result return; may become resume_operation or a dedicated command later.',
    target: 'resume_operation',
  },
  {
    legacy: 'agent_intervention_response (wire)',
    notes: 'Must become resolve_intervention with commandId + interventionId.',
    target: 'resolve_intervention',
  },
  {
    legacy: 'approveToolCalling / reject (client store)',
    notes: 'Local HIL; maps to resolve_intervention (approval).',
    target: 'resolve_intervention',
  },
] as const;
