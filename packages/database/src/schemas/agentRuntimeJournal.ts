import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { agentOperations } from './agentOperations';

/**
 * Append-only Operation Journal for the unified Agent Runtime Protocol.
 *
 * - (operation_id, sequence) unique — monotonic authority for SubscribeOperation
 * - (operation_id, event_id) unique — idempotent append
 * - Product projections (messages, agent_operations status) stay separate tables
 */
export const agentRuntimeJournal = pgTable(
  'agent_runtime_journal',
  {
    id: text('id').primaryKey().notNull(),

    operationId: text('operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),

    eventId: text('event_id').notNull(),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),

    payload: jsonb('payload').$type<unknown>(),
    turnId: text('turn_id'),
    stepId: text('step_id'),

    /** Event production time (protocol meta.timestamp). */
    eventTimestamp: timestamptz('event_timestamp').notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_runtime_journal_op_sequence_uidx').on(t.operationId, t.sequence),
    uniqueIndex('agent_runtime_journal_op_event_id_uidx').on(t.operationId, t.eventId),
    index('agent_runtime_journal_operation_id_idx').on(t.operationId),
    index('agent_runtime_journal_operation_id_sequence_idx').on(t.operationId, t.sequence),
  ],
);

export type NewAgentRuntimeJournal = typeof agentRuntimeJournal.$inferInsert;
export type AgentRuntimeJournalItem = typeof agentRuntimeJournal.$inferSelect;

/**
 * Per-operation monotonic sequence counter for the journal.
 * Allocated via INSERT ... ON CONFLICT DO UPDATE ... RETURNING — never MAX()+1.
 */
export const agentRuntimeJournalCounters = pgTable('agent_runtime_journal_counters', {
  operationId: text('operation_id')
    .primaryKey()
    .notNull()
    .references(() => agentOperations.id, { onDelete: 'cascade' }),

  /** Next sequence to assign (starts at 1). */
  nextSequence: integer('next_sequence').notNull().default(1),

  ...timestamps,
});

export type NewAgentRuntimeJournalCounter = typeof agentRuntimeJournalCounters.$inferInsert;
export type AgentRuntimeJournalCounterItem = typeof agentRuntimeJournalCounters.$inferSelect;

/**
 * Durable checkpoints for recovery (tool idempotency + agent state snapshot).
 */
export const agentRuntimeCheckpoints = pgTable(
  'agent_runtime_checkpoints',
  {
    id: text('id').primaryKey().notNull(),

    operationId: text('operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),

    stepId: text('step_id').notNull(),
    sequence: integer('sequence').notNull(),
    reason: text('reason'),

    agentState: jsonb('agent_state').$type<unknown>().notNull(),
    contextManifest: jsonb('context_manifest').$type<unknown>(),
    pendingCalls: jsonb('pending_calls').$type<unknown>().notNull().default([]),
    pendingIntervention: jsonb('pending_intervention').$type<unknown>(),

    createdAtEvent: timestamptz('created_at_event').notNull(),

    ...timestamps,
  },
  (t) => [
    index('agent_runtime_checkpoints_operation_id_idx').on(t.operationId),
    index('agent_runtime_checkpoints_op_sequence_idx').on(t.operationId, t.sequence),
    uniqueIndex('agent_runtime_checkpoints_op_step_sequence_uidx').on(
      t.operationId,
      t.stepId,
      t.sequence,
    ),
  ],
);

export type NewAgentRuntimeCheckpoint = typeof agentRuntimeCheckpoints.$inferInsert;
export type AgentRuntimeCheckpointItem = typeof agentRuntimeCheckpoints.$inferSelect;

/**
 * Persistent intervention rows (HIL). Complements message_plugins.intervention.
 */
export const agentRuntimeInterventions = pgTable(
  'agent_runtime_interventions',
  {
    id: text('id').primaryKey().notNull(),

    operationId: text('operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),

    interventionId: text('intervention_id').notNull(),
    stepId: text('step_id').notNull(),
    type: text('type', { enum: ['approval', 'input', 'selection'] }).notNull(),
    status: text('status', { enum: ['pending', 'resolved', 'cancelled'] }).notNull(),

    request: jsonb('request').$type<unknown>().notNull(),
    response: jsonb('response').$type<unknown>(),
    resolvedByCommandId: text('resolved_by_command_id'),

    createdAtEvent: timestamptz('created_at_event').notNull(),
    resolvedAt: timestamptz('resolved_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_runtime_interventions_op_intervention_uidx').on(
      t.operationId,
      t.interventionId,
    ),
    index('agent_runtime_interventions_operation_id_idx').on(t.operationId),
    index('agent_runtime_interventions_status_idx').on(t.status),
  ],
);

export type NewAgentRuntimeIntervention = typeof agentRuntimeInterventions.$inferInsert;
export type AgentRuntimeInterventionItem = typeof agentRuntimeInterventions.$inferSelect;

/**
 * Sub-agent execution graph edges.
 */
export const agentRuntimeExecutionEdges = pgTable(
  'agent_runtime_execution_edges',
  {
    id: text('id').primaryKey().notNull(),

    parentOperationId: text('parent_operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),
    childOperationId: text('child_operation_id')
      .notNull()
      .references(() => agentOperations.id, { onDelete: 'cascade' }),

    callId: text('call_id').notNull(),
    relationship: text('relationship', { enum: ['spawn', 'delegate', 'handoff'] }).notNull(),
    status: text('status', {
      enum: ['open', 'completed', 'failed', 'cancelled'],
    })
      .notNull()
      .default('open'),

    closedAt: timestamptz('closed_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_runtime_execution_edges_child_uidx').on(t.childOperationId),
    index('agent_runtime_execution_edges_parent_idx').on(t.parentOperationId),
    index('agent_runtime_execution_edges_call_id_idx').on(t.callId),
  ],
);

export type NewAgentRuntimeExecutionEdge = typeof agentRuntimeExecutionEdges.$inferInsert;
export type AgentRuntimeExecutionEdgeItem = typeof agentRuntimeExecutionEdges.$inferSelect;
