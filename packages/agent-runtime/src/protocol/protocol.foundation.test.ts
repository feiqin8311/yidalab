import { describe, expect, it } from 'vitest';

import { type AgentCheckpoint, InMemoryCheckpointStore, toolIdempotencyKey } from './checkpoint';
import { hasEventEnvelope } from './events';
import {
  applyInterventionTransition,
  createInterventionState,
  operationStatusForIntervention,
} from './intervention';
import { InMemoryOperationJournal } from './journal';
import { createSequenceAllocator, mapEngineEvent } from './legacy-mapping';
import { InMemorySubagentGraphStore } from './subagent-graph';
import { InMemoryProtocolEventBus } from './transport';

describe('protocol foundation (journal / checkpoint / intervention / graph)', () => {
  describe('InMemoryOperationJournal', () => {
    it('appends with unique sequence and supports afterSequence reads', async () => {
      const journal = new InMemoryOperationJournal();
      const seq = createSequenceAllocator(0);
      const ctx = {
        operationId: 'op-j',
        sequences: seq,
        now: () => 1000,
      };
      const events = [
        ...mapEngineEvent({ type: 'init' }, ctx),
        ...mapEngineEvent({ type: 'error', error: { message: 'x' } }, ctx),
      ];
      for (const event of events) {
        await journal.append({ event });
      }
      expect(await journal.getLastSequence('op-j')).toBe(2);
      const after1 = await journal.read({ operationId: 'op-j', afterSequence: 1 });
      expect(after1).toHaveLength(1);
      expect(after1[0]!.sequence).toBe(2);
    });

    it('appendIdempotent returns existing row for same eventId', async () => {
      const journal = new InMemoryOperationJournal();
      const event = mapEngineEvent(
        { type: 'init' },
        {
          operationId: 'op-idemp',
          sequences: createSequenceAllocator(0),
          now: () => 1,
        },
      )[0]!;
      const a = await journal.appendIdempotent({ event });
      const b = await journal.appendIdempotent({ event });
      expect(a.sequence).toBe(b.sequence);
      expect(a.eventId).toBe(b.eventId);
      expect(await journal.getLastSequence('op-idemp')).toBe(1);
    });

    it('rejects duplicate sequence with different eventId', async () => {
      const journal = new InMemoryOperationJournal();
      const e1 = mapEngineEvent(
        { type: 'init' },
        { operationId: 'op-dup', sequences: createSequenceAllocator(0), now: () => 1 },
      )[0]!;
      await journal.append({ event: e1 });
      // Spread + override keeps OperationStartedEvent shape for the type checker.
      const conflict = {
        type: 'operation_started' as const,
        meta: { ...e1.meta, eventId: 'other-id' },
        payload: e1.type === 'operation_started' ? e1.payload : undefined,
      };
      await expect(journal.append({ event: conflict })).rejects.toThrow(/sequence conflict/);
    });
  });

  describe('CheckpointStore', () => {
    it('saves and loads latest / atOrBeforeSequence', async () => {
      const store = new InMemoryCheckpointStore();
      const base: AgentCheckpoint = {
        operationId: 'op-c',
        stepId: 's1',
        sequence: 1,
        agentState: { status: 'running' },
        pendingCalls: [],
        createdAt: 1,
      };
      await store.save(base);
      await store.save({ ...base, stepId: 's2', sequence: 5, agentState: { status: 'done' } });
      expect((await store.load('op-c'))?.sequence).toBe(5);
      expect((await store.load('op-c', { atOrBeforeSequence: 3 }))?.sequence).toBe(1);
    });

    it('builds tool idempotency keys', () => {
      expect(toolIdempotencyKey('op', 'step', 'tc')).toBe('op:step:tc');
    });
  });

  describe('Intervention state machine', () => {
    it('requests, resolves idempotently, and cancels on parent', () => {
      const state = createInterventionState();
      const req = applyInterventionTransition(state, {
        type: 'request',
        intervention: {
          interventionId: 'iv-1',
          operationId: 'op-1',
          stepId: 'step-1',
          type: 'approval',
          request: { tools: [] },
          createdAt: 1,
        },
      });
      expect(req.ok && req.intervention.status).toBe('pending');
      expect(operationStatusForIntervention('approval')).toBe('waiting_for_approval');

      const r1 = applyInterventionTransition(state, {
        type: 'resolve',
        commandId: 'cmd-1',
        interventionId: 'iv-1',
        operationId: 'op-1',
        resolution: { decision: 'approved' },
      });
      expect(r1.ok && !r1.duplicate).toBe(true);
      expect(r1.ok && r1.intervention.status).toBe('resolved');

      const r2 = applyInterventionTransition(state, {
        type: 'resolve',
        commandId: 'cmd-2',
        interventionId: 'iv-1',
        operationId: 'op-1',
        resolution: { decision: 'approved' },
      });
      expect(r2.ok && r2.duplicate).toBe(true);
      expect(r2.ok && r2.intervention.resolvedByCommandId).toBe('cmd-1');
    });

    it('cancel_all_for_operation closes pending interventions', () => {
      const state = createInterventionState();
      applyInterventionTransition(state, {
        type: 'request',
        intervention: {
          interventionId: 'iv-a',
          operationId: 'op-x',
          stepId: 's',
          type: 'input',
          request: {},
          createdAt: 1,
        },
      });
      applyInterventionTransition(state, {
        type: 'request',
        intervention: {
          interventionId: 'iv-b',
          operationId: 'op-x',
          stepId: 's',
          type: 'approval',
          request: {},
          createdAt: 1,
        },
      });
      applyInterventionTransition(state, {
        type: 'cancel_all_for_operation',
        operationId: 'op-x',
        reason: 'parent_cancelled',
      });
      expect(state.byId.get('iv-a')?.status).toBe('cancelled');
      expect(state.byId.get('iv-b')?.status).toBe('cancelled');
      expect(state.pendingByOperation.get('op-x')?.size ?? 0).toBe(0);
    });
  });

  describe('Subagent graph', () => {
    it('tracks children and descendants', async () => {
      const graph = new InMemorySubagentGraphStore();
      await graph.open({
        parentOperationId: 'p',
        childOperationId: 'c1',
        callId: 'call-1',
        relationship: 'spawn',
        createdAt: 1,
      });
      await graph.open({
        parentOperationId: 'c1',
        childOperationId: 'c2',
        callId: 'call-2',
        relationship: 'delegate',
        createdAt: 2,
      });
      expect((await graph.getChildren('p')).map((e) => e.childOperationId)).toEqual(['c1']);
      expect((await graph.getDescendants('p')).map((e) => e.childOperationId)).toEqual([
        'c1',
        'c2',
      ]);
      await graph.close('c2', 'completed');
      expect((await graph.getParent('c2'))?.status).toBe('completed');
    });
  });

  describe('InMemoryProtocolEventBus', () => {
    it('publishes, tracks sequence, and replays on subscribe', () => {
      const bus = new InMemoryProtocolEventBus();
      const events = mapEngineEvent(
        { type: 'init' },
        {
          operationId: 'op-bus',
          sequences: createSequenceAllocator(0),
          now: () => 1,
        },
      );
      for (const e of events) bus.publish(e);
      expect(bus.getLastSequence('op-bus')).toBe(1);

      const received: string[] = [];
      bus.subscribe('op-bus', 0, (e) => {
        expect(hasEventEnvelope(e)).toBe(true);
        received.push(e.type);
      });
      expect(received).toEqual(['operation_started']);
    });
  });
});
