import type { BriefArtifacts, BriefMetadata } from '@lobechat/types';
import { isNotNull, isNull } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamps, timestamptz, varchar255 } from './_helpers';
import { agents } from './agent';
import { agentCronJobs } from './agentCronJob';
import { documents } from './file';
import { topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

// ── Tasks ────────────────────────────────────────────────

export const tasks = pgTable(
  'tasks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('tasks'))
      .notNull(),

    // Workspace-level identifier (e.g. 'T-1', 'PROJ-42')
    identifier: text('identifier').notNull(),
    seq: integer('seq').notNull(),
    // Creator (user or agent)
    createdByUserId: text('created_by_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    createdByAgentId: text('created_by_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),

    // Assignee (user and agent can coexist, both nullable)
    assigneeUserId: text('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    assigneeAgentId: text('assignee_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),

    // Tree structure (self-referencing, no depth limit)
    parentTaskId: text('parent_task_id'),

    // Task definition
    name: text('name'),
    description: varchar255('description'),
    instruction: text('instruction').notNull(),
    // Rich editor JSON state (Lexical). Mirrors the markdown `instruction`
    // but preserves details that markdown drops — image sizes, custom nodes, etc.
    // Optional: when null, callers fall back to parsing `instruction` markdown.
    editorData: jsonb('editor_data'),

    // Lifecycle (same state machine for user and agent)
    // 'backlog' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled'
    status: text('status').notNull().default('backlog'),
    priority: integer('priority').default(0), // 'no' | 'urgent' | 'high' | 'normal' | 'low'
    sortOrder: integer('sort_order').default(0), // manual sort within parent, lower = higher

    // Automation mode (mutually exclusive with each other; null = no automation)
    automationMode: text('automation_mode').$type<'heartbeat' | 'schedule' | 'event'>(),

    // Heartbeat
    heartbeatInterval: integer('heartbeat_interval'), // seconds, null = no heartbeat configured
    heartbeatTimeout: integer('heartbeat_timeout'), // seconds, null = disabled (default off)
    lastHeartbeatAt: timestamptz('last_heartbeat_at'),

    // Schedule (optional)
    schedulePattern: text('schedule_pattern'),
    scheduleTimezone: text('schedule_timezone').default('UTC'),

    /**
     * Next logical fire time for the automation planner (indexed range scan).
     * Source of truth for "when is this task due" under scheduler V2.
     */
    nextRunAt: timestamptz('next_run_at'),
    /**
     * Bumped whenever automation config changes so in-flight/old jobs can be
     * rejected by comparing against the run's captured revision.
     */
    automationRevision: integer('automation_revision').default(0).notNull(),
    /**
     * Wall-clock schedule kind when automationMode='schedule'.
     * cron maps from schedulePattern; at/every use dedicated columns.
     */
    scheduleKind: text('schedule_kind').$type<'at' | 'every' | 'cron'>(),
    /** Absolute fire time for scheduleKind='at' (ISO wall clock, stored UTC). */
    scheduleAt: timestamptz('schedule_at'),
    /** Fixed interval in seconds for scheduleKind='every'. */
    scheduleEverySeconds: integer('schedule_every_seconds'),
    /** Anchor for every-mode (startAt); fires at anchor + n*every. */
    scheduleAnchorAt: timestamptz('schedule_anchor_at'),
    /**
     * Overdue catch-up policy for wall-clock schedules.
     * latest (default) | skip | all (cap 10 per planner tick).
     */
    overduePolicy: text('overdue_policy').$type<'latest' | 'skip' | 'all'>().default('latest'),
    /**
     * Product event catalog key when automationMode='event'
     * (e.g. agent_run_completed) — never raw Agent Signal sourceType.
     */
    eventSourceType: text('event_source_type'),
    /** Typed filter list: [{ field, op: 'eq'|'in', value }...] max 5. */
    eventFilter:
      jsonb('event_filter').$type<
        Array<{ field: string; op: 'eq' | 'in'; value: string | string[] }>
      >(),
    /** Event cooldown seconds; same task/source/scope bucket forms one plan. */
    eventCooldownSeconds: integer('event_cooldown_seconds').default(60),
    /** Dynamic pacing bounds for heartbeat next-check (seconds). */
    pacingMinSeconds: integer('pacing_min_seconds').default(600),
    pacingMaxSeconds: integer('pacing_max_seconds').default(86_400),

    // Topic management
    totalTopics: integer('total_topics').default(0),
    maxTopics: integer('max_topics'), // null = unlimited
    currentTopicId: text('current_topic_id').references(() => topics.id, { onDelete: 'set null' }),

    // Context & config (each task independent, no inheritance from parent)
    context: jsonb('context').default({}),
    config: jsonb('config').default({}), // CheckpointConfig, ReviewConfig, etc.
    error: text('error'),

    // Visibility (mirrors agent.visibility semantics). Workspace-mode rows can be
    // 'public' (visible to every workspace member) or 'private' (only the
    // creator sees them). Personal-mode rows are implicitly private to their
    // owner and the column is ignored.
    visibility: text('visibility', { enum: ['private', 'public'] })
      .default('public')
      .notNull(),

    // Timestamps
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    ...timestamps,
  },
  (t) => [
    // Self-referential FK (defined here to avoid TS circular inference)
    foreignKey({
      columns: [t.parentTaskId],
      foreignColumns: [t.id],
      name: 'tasks_parent_task_id_tasks_id_fk',
    }).onDelete('set null'),
    uniqueIndex('tasks_identifier_idx')
      .on(t.identifier, t.createdByUserId)
      .where(isNull(t.workspaceId)),
    index('tasks_created_by_user_id_idx').on(t.createdByUserId),
    index('tasks_created_by_agent_id_idx').on(t.createdByAgentId),
    index('tasks_assignee_user_id_idx').on(t.assigneeUserId),
    index('tasks_assignee_agent_id_idx').on(t.assigneeAgentId),
    index('tasks_parent_task_id_idx').on(t.parentTaskId),
    index('tasks_status_idx').on(t.status),
    index('tasks_priority_idx').on(t.priority),
    index('tasks_automation_mode_idx').on(t.automationMode),
    index('tasks_heartbeat_idx').on(t.status, t.lastHeartbeatAt),
    index('tasks_next_run_at_idx').on(t.nextRunAt),
    index('tasks_automation_due_idx').on(t.status, t.automationMode, t.nextRunAt),
    index('tasks_workspace_id_idx').on(t.workspaceId),
    index('tasks_workspace_visibility_idx').on(t.workspaceId, t.visibility, t.createdByUserId),
    uniqueIndex('tasks_identifier_workspace_id_unique')
      .on(t.workspaceId, t.identifier)
      .where(isNotNull(t.workspaceId)),
  ],
);

// ── Task Automation Runs (logical plan points) ───────────
//
// One row = one logical trigger (schedule fire / heartbeat due / event).
// UNIQUE(dedupe_key) guarantees at-most-one logical run per plan point.
// Attempts live in task_automation_run_attempts (execution audit).

export const TASK_AUTOMATION_RUN_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'canceled',
] as const;

export type TaskAutomationRunStatus = (typeof TASK_AUTOMATION_RUN_STATUSES)[number];

export const TASK_AUTOMATION_TRIGGERS = ['schedule', 'heartbeat', 'event'] as const;
export type TaskAutomationTrigger = (typeof TASK_AUTOMATION_TRIGGERS)[number];

export const taskAutomationRuns = pgTable(
  'task_automation_runs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('taskAutomationRuns'))
      .notNull(),

    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    trigger: text('trigger').$type<TaskAutomationTrigger>().notNull(),
    /** Wall-clock / relative plan time for this logical run. */
    plannedAt: timestamptz('planned_at').notNull(),
    status: text('status').$type<TaskAutomationRunStatus>().notNull().default('pending'),

    /**
     * Stable unique key for this logical plan point.
     * schedule/heartbeat: `${taskId}:${trigger}:${plannedAt.toISOString()}`
     * event: `${taskId}:event:${sourceEventId}`
     */
    dedupeKey: text('dedupe_key').notNull(),

    /** Snapshot of tasks.automation_revision when the run was planned. */
    automationRevision: integer('automation_revision').notNull().default(0),
    /** How many prior plan points were skipped under overdue=latest. */
    missedCount: integer('missed_count').notNull().default(0),

    /** Aggregate attempt counter (mirrors max attemptNumber). */
    attemptCount: integer('attempt_count').notNull().default(0),
    /** When a failed run becomes eligible for another attempt. */
    nextAttemptAt: timestamptz('next_attempt_at'),

    /** Winning attempt's agent operation / topic (denormalized for list UI). */
    operationId: text('operation_id'),
    topicId: text('topic_id'),

    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    /** Set once when failure alert was delivered (brief / notification). */
    alertedAt: timestamptz('alerted_at'),
    /**
     * Heartbeat pacing request recorded during the run (applied only on success).
     * requested may be clamped into effective.
     */
    requestedNextCheckAt: timestamptz('requested_next_check_at'),
    effectiveNextCheckAt: timestamptz('effective_next_check_at'),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('task_automation_runs_dedupe_key_uidx').on(t.dedupeKey),
    index('task_automation_runs_task_id_idx').on(t.taskId),
    index('task_automation_runs_user_id_idx').on(t.userId),
    index('task_automation_runs_workspace_id_idx').on(t.workspaceId),
    index('task_automation_runs_status_planned_idx').on(t.status, t.plannedAt),
    index('task_automation_runs_pending_dispatch_idx').on(t.status, t.nextAttemptAt, t.plannedAt),
    index('task_automation_runs_task_status_idx').on(t.taskId, t.status),
    index('task_automation_runs_finished_at_idx').on(t.finishedAt),
  ],
);

export type NewTaskAutomationRun = typeof taskAutomationRuns.$inferInsert;
export type TaskAutomationRunItem = typeof taskAutomationRuns.$inferSelect;

// ── Task Automation Run Attempts (execution attempts) ────
//
// One row = one actual execution attempt of a logical run.
// UNIQUE(run_id, attempt_number). Claim/lease live here, not on the run.

export const TASK_AUTOMATION_ATTEMPT_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'canceled',
] as const;

export type TaskAutomationAttemptStatus = (typeof TASK_AUTOMATION_ATTEMPT_STATUSES)[number];

export const taskAutomationRunAttempts = pgTable(
  'task_automation_run_attempts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('taskAutomationRunAttempts'))
      .notNull(),

    runId: text('run_id')
      .references(() => taskAutomationRuns.id, { onDelete: 'cascade' })
      .notNull(),
    attemptNumber: integer('attempt_number').notNull(),

    status: text('status').$type<TaskAutomationAttemptStatus>().notNull().default('pending'),

    /** Why this attempt was created: dispatch | recover | manual_retry */
    reason: text('reason').notNull().default('dispatch'),

    claimToken: text('claim_token'),
    claimedBy: text('claimed_by'),
    leaseUntil: timestamptz('lease_until'),

    /**
     * Agent operation idempotency key: `${runId}:${attemptNumber}`.
     * Also stored on agent_operations.idempotency_key for unique enforcement.
     */
    operationIdempotencyKey: text('operation_idempotency_key').notNull(),
    operationId: text('operation_id'),
    topicId: text('topic_id'),

    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('task_automation_run_attempts_run_attempt_uidx').on(t.runId, t.attemptNumber),
    uniqueIndex('task_automation_run_attempts_op_idem_uidx').on(t.operationIdempotencyKey),
    index('task_automation_run_attempts_run_id_idx').on(t.runId),
    index('task_automation_run_attempts_status_lease_idx').on(t.status, t.leaseUntil),
    index('task_automation_run_attempts_operation_id_idx').on(t.operationId),
  ],
);

export type NewTaskAutomationRunAttempt = typeof taskAutomationRunAttempts.$inferInsert;
export type TaskAutomationRunAttemptItem = typeof taskAutomationRunAttempts.$inferSelect;

// ── Task Dependencies ────────────────────────────────────

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    dependsOnId: text('depends_on_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    // 'blocks' | 'relates'
    type: text('type').notNull().default('blocks'),

    // Mirror of parent task's visibility. Kept in lockstep with `tasks.visibility`
    // by `TaskModel.updateVisibility` cascade so this row can be filtered without
    // joining back to `tasks`.
    visibility: text('visibility', { enum: ['private', 'public'] })
      .default('public')
      .notNull(),

    // Reserved for conditional dependencies: {"on": "success"} / {"on": "failure"}
    condition: jsonb('condition'),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('task_deps_unique_idx').on(t.taskId, t.dependsOnId),
    index('task_deps_task_id_idx').on(t.taskId),
    index('task_deps_depends_on_id_idx').on(t.dependsOnId),
    index('task_deps_user_id_idx').on(t.userId),
    index('task_dependencies_workspace_id_idx').on(t.workspaceId),
    index('task_deps_workspace_visibility_idx').on(t.workspaceId, t.visibility, t.userId),
  ],
);

export type NewTaskDependency = typeof taskDependencies.$inferInsert;
export type TaskDependencyItem = typeof taskDependencies.$inferSelect;

// ── Task Documents (MVP Workspace) ───────────────────────

export const taskDocuments = pgTable(
  'task_documents',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    documentId: text('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    // 'agent' | 'user' | 'system'
    pinnedBy: text('pinned_by').notNull().default('agent'),

    // Mirror of parent task's visibility. Same cascade contract as
    // `task_dependencies.visibility`.
    visibility: text('visibility', { enum: ['private', 'public'] })
      .default('public')
      .notNull(),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('task_docs_unique_idx').on(t.taskId, t.documentId),
    index('task_docs_task_id_idx').on(t.taskId),
    index('task_docs_document_id_idx').on(t.documentId),
    index('task_docs_user_id_idx').on(t.userId),
    index('task_documents_workspace_id_idx').on(t.workspaceId),
    index('task_docs_workspace_visibility_idx').on(t.workspaceId, t.visibility, t.userId),
  ],
);

export type NewTaskDocument = typeof taskDocuments.$inferInsert;
export type TaskDocumentItem = typeof taskDocuments.$inferSelect;

// ── Task Topics ─────────────────────────────────────────

export const taskTopics = pgTable(
  'task_topics',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    seq: integer('seq').notNull(), // topic sequence within task (1, 2, 3...)
    operationId: text('operation_id'), // agent execution operation ID
    // 'running' | 'completed' | 'failed' | 'timeout' | 'canceled'
    status: text('status').notNull().default('running'),

    // What triggered this run: 'manual' (ad-hoc run-now / agent tool call),
    // 'schedule' (cron tick) or 'heartbeat' (interval tick). Null for legacy
    // rows created before this column existed. Used so the maxExecutions quota
    // counts only automation ticks, not manual runs (LOBE-11391).
    trigger: text('trigger').$type<'manual' | 'schedule' | 'heartbeat'>(),

    // Handoff (populated after topic completes via LLM summarization)
    // { title, summary, keyFindings: string[], nextAction }
    handoff: jsonb('handoff'),

    // Review results (populated after topic completes + review runs)
    reviewPassed: integer('review_passed'), // 1 = passed, 0 = failed, null = not reviewed
    reviewScore: integer('review_score'), // overall score 0-100
    reviewScores: jsonb('review_scores'), // [{rubricId, score, passed, reason}]
    reviewIteration: integer('review_iteration'), // which iteration (1, 2, 3...)
    reviewedAt: timestamptz('reviewed_at'),

    // Snapshot of the task's visibility at the time this run was created.
    // Topics inherit `tasks.visibility` on insert but are **not** cascaded by
    // `TaskModel.updateVisibility`: promoting a task to public must not
    // retroactively expose runs that happened while it was private.
    visibility: text('visibility', { enum: ['private', 'public'] })
      .default('public')
      .notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('task_topics_unique_idx').on(t.taskId, t.topicId),
    index('task_topics_task_id_idx').on(t.taskId),
    index('task_topics_topic_id_idx').on(t.topicId),
    index('task_topics_user_id_idx').on(t.userId),
    index('task_topics_status_idx').on(t.taskId, t.status),
    index('task_topics_workspace_id_idx').on(t.workspaceId),
    index('task_topics_workspace_visibility_idx').on(t.workspaceId, t.visibility, t.userId),
  ],
);

export type NewTaskTopic = typeof taskTopics.$inferInsert;
export type TaskTopicItem = typeof taskTopics.$inferSelect;

// ── Briefs ─────────────────────────────────────────────

export const briefs = pgTable(
  'briefs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('briefs'))
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    // Source (polymorphic, fill as needed)
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    cronJobId: text('cron_job_id').references(() => agentCronJobs.id, { onDelete: 'cascade' }),
    topicId: text('topic_id'),
    agentId: text('agent_id'),

    // Content
    type: text('type').notNull(), // 'decision' | 'result' | 'insight' | 'error'
    priority: text('priority').default('info'), // 'urgent' | 'normal' | 'info'
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    artifacts: jsonb('artifacts').$type<BriefArtifacts>(), // programmatically collected at synthesis
    actions: jsonb('actions'), // BriefAction[]

    // Resolution
    resolvedAction: text('resolved_action'),
    resolvedComment: text('resolved_comment'),
    readAt: timestamptz('read_at'),
    resolvedAt: timestamptz('resolved_at'),

    trigger: varchar255('trigger'), // field for which module triggered the brief, e.g. task, agent, signal, etc.
    metadata: jsonb('metadata').$type<BriefMetadata>(), // freeform field for business and states.

    createdAt: createdAt(),
  },
  (t) => [
    index('briefs_user_id_idx').on(t.userId),
    index('briefs_task_id_idx').on(t.taskId),
    index('briefs_cron_job_id_idx').on(t.cronJobId),
    index('briefs_agent_id_idx').on(t.agentId),
    index('briefs_type_idx').on(t.type),
    index('briefs_priority_idx').on(t.priority),
    index('briefs_unresolved_idx').on(t.userId, t.resolvedAt),
    index('briefs_trigger_idx').on(t.trigger),
    index('briefs_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewBrief = typeof briefs.$inferInsert;
export type BriefItem = typeof briefs.$inferSelect;

// ── Task Comments ───────────────────────────────────────

export const taskComments = pgTable(
  'task_comments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('taskComments'))
      .notNull(),
    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    // Author (user or agent, both nullable)
    authorUserId: text('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    authorAgentId: text('author_agent_id').references(() => agents.id, { onDelete: 'set null' }),

    // Content
    content: text('content').notNull(),
    editorData: jsonb('editor_data'),

    // Optional references
    briefId: text('brief_id').references(() => briefs.id, { onDelete: 'set null' }),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),

    // Mirror of parent task's visibility. Same cascade contract as the other
    // task-child tables (`task_dependencies` / `task_documents` / `task_topics`).
    // Lets `commentsOwnership` filter without joining back to `tasks`, and
    // closes the leak where a workspace member who somehow obtained a
    // commentId could touch a comment on a task they cannot see.
    visibility: text('visibility', { enum: ['private', 'public'] })
      .default('public')
      .notNull(),

    ...timestamps,
  },
  (t) => [
    index('task_comments_task_id_idx').on(t.taskId),
    index('task_comments_user_id_idx').on(t.userId),
    index('task_comments_author_user_id_idx').on(t.authorUserId),
    index('task_comments_agent_id_idx').on(t.authorAgentId),
    index('task_comments_brief_id_idx').on(t.briefId),
    index('task_comments_topic_id_idx').on(t.topicId),
    index('task_comments_workspace_id_idx').on(t.workspaceId),
    index('task_comments_workspace_visibility_idx').on(t.workspaceId, t.visibility, t.userId),
  ],
);

export type NewTaskComment = typeof taskComments.$inferInsert;
export type TaskCommentItem = typeof taskComments.$inferSelect;
