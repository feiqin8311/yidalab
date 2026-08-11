// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  agentRuntimeInterventions,
  agentRuntimeJournal,
  agentRuntimeJournalCounters,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentRuntimeProtocolModel } from '../agentRuntimeProtocol';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'agent-runtime-protocol-test-user';
const opA = 'arp-op-a';
const opB = 'arp-op-b';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
  await serverDB.insert(agentOperations).values([
    { id: opA, status: 'running', userId },
    { id: opB, status: 'running', userId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(agentRuntimeJournal);
  await serverDB.delete(agentRuntimeJournalCounters);
  await serverDB.delete(agentRuntimeInterventions);
  await serverDB.delete(agentOperations);
  await serverDB.delete(users);
});

describe('AgentRuntimeProtocolModel (postgres)', () => {
  const model = () => new AgentRuntimeProtocolModel(serverDB);

  describe('appendJournalAtomic', () => {
    it('allocates monotonic sequences via counter row (not MAX+1 race)', async () => {
      const m = model();
      const a = await m.appendJournalAtomic({
        eventId: 'e1',
        eventTimestamp: new Date(),
        operationId: opA,
        type: 'operation_started',
      });
      const b = await m.appendJournalAtomic({
        eventId: 'e2',
        eventTimestamp: new Date(),
        operationId: opA,
        type: 'turn_started',
      });
      expect(a.inserted).toBe(true);
      expect(b.inserted).toBe(true);
      if (!a.inserted || !b.inserted) return;
      expect(a.row.sequence).toBe(1);
      expect(b.row.sequence).toBe(2);
    });

    it('is idempotent on same eventId without burning a new sequence on re-read path', async () => {
      const m = model();
      const first = await m.appendJournalAtomic({
        eventId: 'same-id',
        eventTimestamp: new Date(),
        operationId: opA,
        type: 'operation_started',
      });
      const second = await m.appendJournalAtomic({
        eventId: 'same-id',
        eventTimestamp: new Date(),
        operationId: opA,
        type: 'operation_started',
      });
      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      if (!first.inserted || second.inserted) return;
      expect(second.reason).toBe('event_id_conflict');
      expect(second.row?.sequence).toBe(first.row.sequence);
    });

    it('isolates sequences per operationId', async () => {
      const m = model();
      const a = await m.appendJournalAtomic({
        eventId: 'a1',
        eventTimestamp: new Date(),
        operationId: opA,
        type: 'operation_started',
      });
      const b = await m.appendJournalAtomic({
        eventId: 'b1',
        eventTimestamp: new Date(),
        operationId: opB,
        type: 'operation_started',
      });
      if (!a.inserted || !b.inserted) return;
      expect(a.row.sequence).toBe(1);
      expect(b.row.sequence).toBe(1);
    });

    it('handles concurrent appends without sequence collision', async () => {
      const m = model();
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          m.appendJournalAtomic({
            eventId: `concurrent-${i}`,
            eventTimestamp: new Date(),
            operationId: opA,
            type: 'turn_started',
          }),
        ),
      );
      const inserted = results.filter((r) => r.inserted);
      expect(inserted).toHaveLength(20);
      const sequences = inserted
        .map((r) => (r.inserted ? r.row.sequence : 0))
        .sort((x, y) => x - y);
      expect(sequences).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });
  });

  describe('intervention state machine', () => {
    it('request never overwrites resolved; resolve is pending-only', async () => {
      const m = model();
      const req1 = await m.requestIntervention({
        createdAtEvent: new Date(),
        interventionId: 'approve:tc-1',
        operationId: opA,
        request: { tools: ['tc-1'] },
        stepId: 'step:1',
        type: 'approval',
      });
      expect(req1.ok).toBe(true);

      const res = await m.resolveIntervention({
        commandId: 'cmd-approve-1',
        interventionId: 'approve:tc-1',
        operationId: opA,
        resolution: { decision: 'approved' },
      });
      expect(res).toEqual({ ok: true, duplicate: false, status: 'resolved' });

      // Re-request must not flip resolved → pending
      const req2 = await m.requestIntervention({
        createdAtEvent: new Date(),
        interventionId: 'approve:tc-1',
        operationId: opA,
        request: { tools: ['tc-1'] },
        stepId: 'step:1',
        type: 'approval',
      });
      expect(req2.ok).toBe(true);
      if (req2.ok) expect(req2.status).toBe('resolved');

      // Duplicate resolve is idempotent no-op
      const res2 = await m.resolveIntervention({
        commandId: 'cmd-approve-2',
        interventionId: 'approve:tc-1',
        operationId: opA,
        resolution: { decision: 'approved' },
      });
      expect(res2).toEqual({ ok: true, duplicate: true, status: 'resolved' });
    });

    it('resolve returns not_found when intervention missing', async () => {
      const m = model();
      const res = await m.resolveIntervention({
        commandId: 'cmd-x',
        interventionId: 'approve:missing',
        operationId: opA,
        resolution: {},
      });
      expect(res).toEqual({ ok: false, error: 'not_found' });
    });

    it('concurrent resolve: only one non-duplicate winner', async () => {
      const m = model();
      await m.requestIntervention({
        createdAtEvent: new Date(),
        interventionId: 'approve:race',
        operationId: opA,
        request: {},
        stepId: 'step:1',
        type: 'approval',
      });

      const [r1, r2] = await Promise.all([
        m.resolveIntervention({
          commandId: 'cmd-a',
          interventionId: 'approve:race',
          operationId: opA,
          resolution: { who: 'a' },
        }),
        m.resolveIntervention({
          commandId: 'cmd-b',
          interventionId: 'approve:race',
          operationId: opA,
          resolution: { who: 'b' },
        }),
      ]);

      const winners = [r1, r2].filter((r) => r.ok && !r.duplicate);
      const dups = [r1, r2].filter((r) => r.ok && r.duplicate);
      expect(winners).toHaveLength(1);
      expect(dups).toHaveLength(1);
    });
  });
});
