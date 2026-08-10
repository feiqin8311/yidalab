import type { AgentRuntimeContext } from '@lobechat/agent-runtime';
import { approvalInterventionId, stableResolveCommandId } from '@lobechat/agent-runtime';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';
import { persistInterventionResolve } from '@/server/modules/AgentRuntime/protocolRecovery';

import { hookDispatcher } from './hooks';

const log = debug('lobe-server:human-intervention-handler');

export interface InterventionInput {
  approvedToolCall?: any;
  humanInput?: any;
  rejectAndContinue?: boolean;
  rejectionReason?: string;
  toolMessageId?: string;
}

/**
 * Discriminated result so AgentRuntimeService can short-circuit without
 * calling runtime.step (which would invent an init context when nextContext
 * is undefined and still run the agent/LLM).
 */
export type InterventionResult =
  | { kind: 'resume'; newState: any; nextContext: AgentRuntimeContext }
  | { kind: 'parked'; newState: any }
  | { kind: 'halted'; newState: any }
  | { kind: 'duplicate'; newState: any }
  | { kind: 'failed'; newState: any; error: string }
  | { kind: 'passthrough' };

/**
 * Owns the three branches of human intervention on a `waiting_for_human`
 * operation, mirroring `conversationControl.ts` on the client side:
 *
 * - `approveToolCalling` → write `intervention.status='approved'`, resume via
 *   `phase: 'human_approved_tool'` so the runtime short-circuits into
 *   `call_tool` with `skipCreateToolMessage: true`.
 * - `rejectAndContinueToolCalling` → write `intervention.status='rejected'`
 *   and resume via `phase: 'user_input'` once the rest of the batch is
 *   resolved, so the next LLM call treats the rejection as user feedback.
 * - `rejectToolCalling` (halt) → write `intervention.status='rejected'` and
 *   move to `status='interrupted'` with `interruption.reason='human_rejected'`.
 *
 * Each branch is a self-contained method so the routing in `process()` reads
 * top-to-bottom: detect approval, then rejection, then unsupported humanInput.
 */
export class HumanInterventionHandler {
  constructor(
    private readonly serverDB: LobeChatDatabase,
    private readonly messageModel: MessageModel,
  ) {}

  async process(state: any, intervention: InterventionInput): Promise<InterventionResult> {
    const { humanInput, approvedToolCall, rejectAndContinue, rejectionReason, toolMessageId } =
      intervention;

    if (approvedToolCall && state.status === 'waiting_for_human') {
      return this.approve(state, approvedToolCall, toolMessageId);
    }

    if (rejectionReason && state.status === 'waiting_for_human') {
      return this.reject(state, { rejectAndContinue, rejectionReason, toolMessageId });
    }

    // human_prompt / human_select — out of scope; let the regular step loop run.
    if (humanInput) {
      return { kind: 'passthrough' };
    }

    return { kind: 'passthrough' };
  }

  private async approve(
    state: any,
    approvedToolCall: any,
    toolMessageId: string | undefined,
  ): Promise<InterventionResult> {
    if (!toolMessageId) {
      log('approve requires toolMessageId, got undefined');
      return { kind: 'failed', newState: state, error: 'missing_tool_message_id' };
    }

    const operationId = state.metadata?.operationId ?? state.operationId ?? '';
    const toolCallId = approvedToolCall.id ?? toolMessageId;
    const interventionId = approvalInterventionId(toolCallId);
    // Stable commandId (no Date.now) — retries of the same logical approve share it.
    const commandId = stableResolveCommandId(operationId, interventionId, 'approved');
    // Protocol first: atomic resolve before product side effects.
    // !ok → abort; duplicate → idempotent no-op (do not re-run tools).
    const resolveResult = await persistInterventionResolve({
      commandId,
      db: this.serverDB,
      interventionId,
      operationId,
      resolution: { decision: 'approved', toolCallId, toolMessageId },
    });
    if (!resolveResult.ok) {
      log(
        'approve resolve failed op=%s intervention=%s: %s',
        operationId,
        interventionId,
        resolveResult.error,
      );
      return {
        kind: 'failed',
        newState: state,
        error: resolveResult.error ?? 'resolve_failed',
      };
    }
    if (resolveResult.duplicate) {
      log('approve duplicate no-op op=%s intervention=%s', operationId, interventionId);
      return { kind: 'duplicate', newState: state };
    }

    await this.messageModel.updateMessagePlugin(toolMessageId, {
      intervention: { status: 'approved' },
    });

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.pendingToolsCalling = (state.pendingToolsCalling ?? []).filter(
      (t: any) => t.id !== approvedToolCall.id,
    );
    // Keep waiting_for_human while other tools remain pending; resume to
    // running when this was the last one.
    newState.status = newState.pendingToolsCalling.length > 0 ? 'waiting_for_human' : 'running';

    hookDispatcher
      .dispatch(
        state.metadata?.operationId ?? '',
        'afterHumanIntervention',
        {
          action: 'approve',
          operationId: state.metadata?.operationId ?? '',
          toolCallId: approvedToolCall.id,
          userId: state.metadata?.userId,
        },
        state.metadata?._hooks,
      )
      .catch(() => {});

    return {
      kind: 'resume',
      newState,
      nextContext: {
        payload: {
          approvedToolCall,
          parentMessageId: toolMessageId,
          skipCreateToolMessage: true,
        },
        phase: 'human_approved_tool',
      },
    };
  }

  private async reject(
    state: any,
    params: {
      rejectAndContinue?: boolean;
      rejectionReason: string;
      toolMessageId: string | undefined;
    },
  ): Promise<InterventionResult> {
    const { rejectAndContinue, rejectionReason, toolMessageId } = params;

    if (!toolMessageId) {
      log('reject requires toolMessageId, got undefined');
      return { kind: 'failed', newState: state, error: 'missing_tool_message_id' };
    }

    const rejectionContent = rejectionReason
      ? `User reject this tool calling with reason: ${rejectionReason}`
      : 'User reject this tool calling without reason';

    // Find the tool_call_id for this tool message so we can drop it from
    // pendingToolsCalling. pendingToolsCalling holds ChatToolPayload[] whose
    // id === tool_call_id; the mapping lives in messagePlugins (plugin id
    // === message id, toolCallId is a separate column).
    const rejectedToolCallId = await this.lookupToolCallId(toolMessageId);

    const operationId = state.metadata?.operationId ?? state.operationId ?? '';
    const interventionId = approvalInterventionId(rejectedToolCallId ?? toolMessageId);
    const decision = rejectAndContinue ? 'rejected_continue' : 'rejected';
    const commandId = stableResolveCommandId(operationId, interventionId, decision);
    // Protocol first: atomic resolve before product side effects.
    const resolveResult = await persistInterventionResolve({
      commandId,
      db: this.serverDB,
      interventionId,
      operationId,
      resolution: {
        decision,
        rejectionReason,
        toolCallId: rejectedToolCallId,
        toolMessageId,
      },
    });
    if (!resolveResult.ok) {
      log(
        'reject resolve failed op=%s intervention=%s: %s',
        operationId,
        interventionId,
        resolveResult.error,
      );
      return {
        kind: 'failed',
        newState: state,
        error: resolveResult.error ?? 'resolve_failed',
      };
    }
    if (resolveResult.duplicate) {
      log('reject duplicate no-op op=%s intervention=%s', operationId, interventionId);
      return { kind: 'duplicate', newState: state };
    }

    await this.messageModel.updateToolMessage(toolMessageId, { content: rejectionContent });
    await this.messageModel.updateMessagePlugin(toolMessageId, {
      intervention: { rejectedReason: rejectionReason, status: 'rejected' },
    });

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.pendingToolsCalling = rejectedToolCallId
      ? (state.pendingToolsCalling ?? []).filter((t: any) => t.id !== rejectedToolCallId)
      : (state.pendingToolsCalling ?? []);

    if (rejectAndContinue) {
      return this.rejectAndContinue(state, newState, rejectionReason, rejectedToolCallId);
    }

    return this.rejectAndHalt(state, newState, rejectionReason, rejectedToolCallId);
  }

  /**
   * Persist the rejection, then either (a) wait for the remaining pending
   * tools to be resolved or (b) resume LLM once this is the last one.
   */
  private rejectAndContinue(
    state: any,
    newState: any,
    rejectionReason: string,
    rejectedToolCallId: string | undefined,
  ): InterventionResult {
    hookDispatcher
      .dispatch(
        state.metadata?.operationId ?? '',
        'afterHumanIntervention',
        {
          action: 'rejectAndContinue',
          operationId: state.metadata?.operationId ?? '',
          rejectionReason,
          toolCallId: rejectedToolCallId,
          userId: state.metadata?.userId,
        },
        state.metadata?._hooks,
      )
      .catch(() => {});

    if (newState.pendingToolsCalling.length > 0) {
      newState.status = 'waiting_for_human';
      // Must not call runtime.step — would invent init context and resume LLM.
      return { kind: 'parked', newState };
    }

    newState.status = 'running';
    return { kind: 'resume', newState, nextContext: { phase: 'user_input' } };
  }

  /**
   * Halt: use `interrupted` + `reason='human_rejected'` to reuse the existing
   * terminal-state plumbing (early-exit, completion hooks, etc).
   */
  private rejectAndHalt(
    state: any,
    newState: any,
    rejectionReason: string,
    rejectedToolCallId: string | undefined,
  ): InterventionResult {
    hookDispatcher
      .dispatch(
        state.metadata?.operationId ?? '',
        'onStopByHumanIntervention',
        {
          operationId: state.metadata?.operationId ?? '',
          rejectionReason,
          toolCallId: rejectedToolCallId,
          userId: state.metadata?.userId,
        },
        state.metadata?._hooks,
      )
      .catch(() => {});

    newState.status = 'interrupted';
    newState.interruption = {
      canResume: false,
      interruptedAt: new Date().toISOString(),
      reason: 'human_rejected',
    };
    return { kind: 'halted', newState };
  }

  private async lookupToolCallId(toolMessageId: string): Promise<string | undefined> {
    try {
      const plugin = await this.serverDB.query.messagePlugins.findFirst({
        where: (mp: any, { eq }: any) => eq(mp.id, toolMessageId),
      });
      return (plugin as any)?.toolCallId ?? undefined;
    } catch (error) {
      log('failed to look up tool plugin: %O', error);
      return undefined;
    }
  }
}
