import { describe, expect, expectTypeOf, it } from 'vitest';

import type { AgentEvent } from '../types/event';
import type {
  AgentRuntimeCommand,
  ResolveInterventionCommand,
  ResumeOperationCommand,
  SubscribeOperationCommand,
} from './commands';
import {
  AGENT_RUNTIME_COMMAND_TYPES,
  AGENT_RUNTIME_EVENT_TYPES,
  type AgentRuntimeEvent,
  hasEventEnvelope,
  isJournalableEventType,
  isValidSequence,
  type ItemStartedEvent,
  type OperationStartedEvent,
  type TurnStartedEvent,
} from './events';
import {
  createSequenceAllocator,
  ENGINE_EVENT_MAPPING,
  LEGACY_COMMAND_MAPPING,
  type LegacyWireEventInput,
  mapEngineEvent,
  mapWireEvent,
  WIRE_EVENT_MAPPING,
} from './legacy-mapping';

describe('Agent Runtime Protocol (PR1)', () => {
  describe('discriminated unions', () => {
    it('exposes exhaustive command type list', () => {
      expect(AGENT_RUNTIME_COMMAND_TYPES).toEqual([
        'start_operation',
        'resume_operation',
        'subscribe_operation',
        'steer_operation',
        'interrupt_operation',
        'resolve_intervention',
      ]);
    });

    it('exposes exhaustive event type list', () => {
      expect(AGENT_RUNTIME_EVENT_TYPES).toEqual([
        'operation_started',
        'operation_completed',
        'operation_failed',
        'operation_interrupted',
        'turn_started',
        'turn_completed',
        'item_started',
        'item_delta',
        'item_completed',
        'intervention_requested',
        'checkpoint_created',
      ]);
    });

    it('keeps Resume and Subscribe as distinct command types', () => {
      const resume: ResumeOperationCommand = {
        type: 'resume_operation',
        commandId: 'cmd-1',
        operationId: 'op-1',
        reason: 'after_approval',
      };
      const subscribe: SubscribeOperationCommand = {
        type: 'subscribe_operation',
        commandId: 'cmd-2',
        operationId: 'op-1',
        afterSequence: 0,
      };

      expect(resume.type).not.toBe(subscribe.type);
      expectTypeOf(resume).not.toMatchTypeOf<SubscribeOperationCommand>();
      expectTypeOf(subscribe).not.toMatchTypeOf<ResumeOperationCommand>();

      const commands: AgentRuntimeCommand[] = [resume, subscribe];
      expect(commands.map((c) => c.type)).toEqual(['resume_operation', 'subscribe_operation']);
    });

    it('requires ResolveIntervention idempotency fields', () => {
      const cmd: ResolveInterventionCommand = {
        type: 'resolve_intervention',
        commandId: 'cmd-hil-1',
        operationId: 'op-1',
        interventionId: 'iv-1',
        kind: 'approval',
        resolution: { decision: 'approved' },
      };

      expect(cmd.commandId).toBeTruthy();
      expect(cmd.interventionId).toBeTruthy();
      expect(cmd.operationId).toBeTruthy();
      expectTypeOf(cmd.commandId).toBeString();
      expectTypeOf(cmd.interventionId).toBeString();
    });
  });

  describe('journalable control plane', () => {
    it('excludes item_delta from durable journal types', () => {
      expect(isJournalableEventType('item_delta')).toBe(false);
      expect(isJournalableEventType('operation_started')).toBe(true);
      expect(isJournalableEventType('intervention_requested')).toBe(true);
      expect(isJournalableEventType('operation_interrupted')).toBe(true);
    });
  });

  describe('sequence is required', () => {
    it('accepts finite non-negative integers only', () => {
      expect(isValidSequence(0)).toBe(true);
      expect(isValidSequence(1)).toBe(true);
      expect(isValidSequence(-1)).toBe(false);
      expect(isValidSequence(1.5)).toBe(false);
      expect(isValidSequence(Number.NaN)).toBe(false);
      expect(isValidSequence(undefined)).toBe(false);
      expect(isValidSequence(null)).toBe(false);
    });

    it('operation / turn / item events all require sequence on meta', () => {
      const op: OperationStartedEvent = {
        type: 'operation_started',
        meta: {
          eventId: 'e1',
          operationId: 'op-1',
          sequence: 1,
          timestamp: 0,
        },
      };
      const turn: TurnStartedEvent = {
        type: 'turn_started',
        meta: {
          eventId: 'e2',
          operationId: 'op-1',
          sequence: 2,
          timestamp: 0,
          turnId: 't1',
        },
      };
      const item: ItemStartedEvent = {
        type: 'item_started',
        meta: {
          eventId: 'e3',
          operationId: 'op-1',
          sequence: 3,
          stepId: 's1',
          timestamp: 0,
          turnId: 't1',
        },
        payload: { kind: 'assistant_message' },
      };

      for (const event of [op, turn, item] satisfies AgentRuntimeEvent[]) {
        expect(hasEventEnvelope(event)).toBe(true);
        expect(isValidSequence(event.meta.sequence)).toBe(true);
      }

      // sequence is not optional on the type
      expectTypeOf(op.meta.sequence).toBeNumber();
      expectTypeOf(turn.meta.sequence).toBeNumber();
      expectTypeOf(item.meta.sequence).toBeNumber();
    });

    it('scopes force turnId / stepId where required', () => {
      const turn: TurnStartedEvent = {
        type: 'turn_started',
        meta: {
          eventId: 'e',
          operationId: 'op',
          sequence: 1,
          timestamp: 0,
          turnId: 'turn-1',
        },
      };
      const item: ItemStartedEvent = {
        type: 'item_started',
        meta: {
          eventId: 'e',
          operationId: 'op',
          sequence: 2,
          stepId: 'step-1',
          timestamp: 0,
          turnId: 'turn-1',
        },
        payload: { kind: 'tool_call' },
      };

      expectTypeOf(turn.meta.turnId).toBeString();
      expectTypeOf(item.meta.turnId).toBeString();
      expectTypeOf(item.meta.stepId).toBeString();
      // operation-scoped events must not require turnId
      expectTypeOf<OperationStartedEvent['meta']>().not.toHaveProperty('turnId');
    });
  });

  describe('sequence allocator', () => {
    it('mints monotonic sequences starting after the given value', () => {
      const seq = createSequenceAllocator(0);
      expect(seq.current).toBe(0);
      expect(seq.next()).toBe(1);
      expect(seq.next()).toBe(2);
      expect(seq.current).toBe(2);
    });
  });

  describe('engine event mapping', () => {
    const ctxBase = () => ({
      operationId: 'op-engine',
      sequences: createSequenceAllocator(0),
      now: () => 1_700_000_000_000,
    });

    it('maps init / done / error with required sequence', () => {
      const ctx = ctxBase();
      const events = [
        ...mapEngineEvent({ type: 'init' }, ctx),
        ...mapEngineEvent(
          {
            type: 'done',
            reason: 'completed',
            finalState: {} as AgentEvent extends { type: 'done'; finalState: infer F } ? F : never,
          } as AgentEvent,
          ctx,
        ),
        ...mapEngineEvent({ type: 'error', error: { message: 'x' } }, ctx),
      ];

      expect(events.map((e) => e.type)).toEqual([
        'operation_started',
        'operation_completed',
        'operation_failed',
      ]);
      expect(events.map((e) => e.meta.sequence)).toEqual([1, 2, 3]);
      events.forEach((e) => expect(hasEventEnvelope(e)).toBe(true));
    });

    it('maps HIL engine events to per-tool intervention_requested', () => {
      const ctx = ctxBase();
      const events = mapEngineEvent(
        {
          type: 'human_approve_required',
          operationId: 'op-engine',
          pendingToolsCalling: [{ id: 'tc-1' } as never, { id: 'tc-2' } as never],
        },
        ctx,
      );

      expect(events).toHaveLength(2);
      expect(events.map((e) => e.type)).toEqual([
        'intervention_requested',
        'intervention_requested',
      ]);
      if (events[0]?.type === 'intervention_requested') {
        expect(events[0].payload.interventionId).toBe('approve:tc-1');
        expect(events[0].payload.kind).toBe('approval');
      }
      if (events[1]?.type === 'intervention_requested') {
        expect(events[1].payload.interventionId).toBe('approve:tc-2');
      }
    });

    it('maps interrupted to operation_interrupted not failed', () => {
      const ctx = ctxBase();
      const [event] = mapEngineEvent(
        {
          type: 'interrupted',
          canResume: true,
          interruptedAt: 't',
          reason: 'user',
        },
        ctx,
      );
      expect(event?.type).toBe('operation_interrupted');
    });

    it('drops engine resumed (command direction, not event)', () => {
      const ctx = ctxBase();
      expect(
        mapEngineEvent(
          {
            type: 'resumed',
            reason: 'manual',
            resumedAt: new Date().toISOString(),
            resumedFromStep: 1,
          },
          ctx,
        ),
      ).toEqual([]);
    });

    it('covers every engine mapping matrix entry source', () => {
      const sources = ENGINE_EVENT_MAPPING.map((m) => m.source);
      expect(new Set(sources).size).toBe(sources.length);
      expect(sources).toContain('init');
      expect(sources).toContain('resumed');
      expect(sources).toContain('human_approve_required');
    });
  });

  describe('wire event mapping', () => {
    const ctxBase = () => ({
      operationId: 'op-wire',
      sequences: createSequenceAllocator(0),
      now: () => 1_700_000_000_000,
    });

    function wire(
      type: string,
      overrides: Partial<LegacyWireEventInput> = {},
    ): LegacyWireEventInput {
      return {
        type,
        operationId: 'op-wire',
        stepIndex: 0,
        timestamp: 1_700_000_000_000,
        data: {},
        ...overrides,
      };
    }

    it('maps lifecycle wire events with monotonic sequence', () => {
      const ctx = ctxBase();
      const mapped = [
        ...mapWireEvent(wire('agent_runtime_init'), ctx),
        ...mapWireEvent(wire('step_start', { stepIndex: 1 }), ctx),
        ...mapWireEvent(wire('stream_start', { stepIndex: 1 }), ctx),
        ...mapWireEvent(
          wire('stream_chunk', {
            stepIndex: 1,
            data: { chunkType: 'text', content: 'hi' },
          }),
          ctx,
        ),
        ...mapWireEvent(wire('stream_end', { stepIndex: 1 }), ctx),
        ...mapWireEvent(wire('step_complete', { stepIndex: 1 }), ctx),
        ...mapWireEvent(wire('agent_runtime_end', { data: { reason: 'completed' } }), ctx),
      ];

      expect(mapped.map((e) => e.type)).toEqual([
        'operation_started',
        'turn_started',
        'item_started',
        'item_delta',
        'item_completed',
        'turn_completed',
        'operation_completed',
      ]);
      expect(mapped.map((e) => e.meta.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      mapped.forEach((e) => expect(hasEventEnvelope(e)).toBe(true));
    });

    it('does not map transport-only or reverse-RPC wire types', () => {
      const ctx = ctxBase();
      for (const type of [
        'visible_output_end',
        'tool_execute',
        'agent_intervention_response',
        'notify_update',
      ]) {
        expect(mapWireEvent(wire(type), ctx)).toEqual([]);
      }
    });

    it('maps agent_intervention_request with interventionId from toolCallId', () => {
      const ctx = ctxBase();
      const [event] = mapWireEvent(
        wire('agent_intervention_request', {
          data: { toolCallId: 'tc-99', apiName: 'askUserQuestion' },
        }),
        ctx,
      );
      expect(event?.type).toBe('intervention_requested');
      if (event?.type === 'intervention_requested') {
        expect(event.payload.interventionId).toBe('tc-99');
      }
    });

    it('uses bare Redis wire id as eventId (not process sequence)', () => {
      const ctx = ctxBase();
      const [a] = mapWireEvent(wire('agent_runtime_init', { id: 'redis-1-0' }), ctx);
      const [b] = mapWireEvent(wire('agent_runtime_end', { id: 'redis-2-0' }), ctx);
      expect(a?.meta.eventId).toBe('redis-1-0');
      expect(b?.meta.eventId).toBe('redis-2-0');
      // sequence still monotonic for session mapping, but eventId independent
      expect(a?.meta.sequence).toBe(1);
      expect(b?.meta.sequence).toBe(2);
    });

    it('stable wire eventId survives sequence allocator restart', () => {
      const wireId = 'redis-stable-99';
      const first = mapWireEvent(wire('step_start', { id: wireId, stepIndex: 1 }), ctxBase())[0];
      const second = mapWireEvent(wire('step_start', { id: wireId, stepIndex: 1 }), ctxBase())[0];
      expect(first?.meta.eventId).toBe(wireId);
      expect(second?.meta.eventId).toBe(wireId);
      expect(first?.meta.eventId).toBe(second?.meta.eventId);
    });

    it('documents WS resume as subscribe_operation, not resume_operation', () => {
      const row = LEGACY_COMMAND_MAPPING.find((r) => r.legacy.includes('ResumeMessage'));
      expect(row?.target).toBe('subscribe_operation');
      expect(row?.notes).toMatch(/NEVER resume_operation/);
    });

    it('covers wire mapping matrix sources without declaring a third stream union', () => {
      const sources = WIRE_EVENT_MAPPING.map((m) => m.source);
      expect(sources).toContain('agent_runtime_init');
      expect(sources).toContain('tool_execute');
      expect(sources).toContain('notify_update');
      // unmapped rows still listed
      expect(WIRE_EVENT_MAPPING.filter((m) => m.fidelity === 'unmapped').length).toBeGreaterThan(0);
    });
  });
});
