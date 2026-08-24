/**
 * Direct memory-extraction orchestration without Upstash Workflow.
 * Fan-out uses InternalJobQueue via MemoryExtractionWorkflowService triggers.
 */
import { AsyncTaskStatus, LayersEnum, MemorySourceType } from '@lobechat/types';
import { chunk } from 'es-toolkit/compat';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { getServerDB } from '@/database/server';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import {
  buildUserPersonaJobInput,
  UserPersonaService,
} from '@/server/services/memory/userMemory/persona/service';

import {
  buildWorkflowPayloadInput,
  MemoryExtractionExecutor,
  type MemoryExtractionHourlyWorkflowPayload,
  type MemoryExtractionPayloadInput,
  MemoryExtractionWorkflowService,
  normalizeMemoryExtractionPayload,
} from './extract';

const USER_PAGE_SIZE = 50;
const USER_BATCH_SIZE = 10;
const TOPIC_PAGE_SIZE = 50;
const TOPIC_BATCH_SIZE = 4;
const HOURLY_USER_PAGE = 200;
const HOURLY_USER_BATCH = 20;

const CEPA_LAYERS: LayersEnum[] = [
  LayersEnum.Context,
  LayersEnum.Experience,
  LayersEnum.Preference,
  LayersEnum.Activity,
];
const IDENTITY_LAYERS: LayersEnum[] = [LayersEnum.Identity];

const { workflow } = parseMemoryExtractionConfig();
const MAX_TOPICS_PER_USER_PER_RUN = workflow?.maxTopicsPerUserPerRun ?? 100;

const serializeCursor = (cursor: { createdAt: Date; id: string }) => ({
  createdAt: cursor.createdAt.toISOString(),
  id: cursor.id,
});

export async function runMemoryProcessUsers(raw: MemoryExtractionPayloadInput) {
  const params = normalizeMemoryExtractionPayload(raw || {});
  if (params.sources.length === 0) {
    return { message: 'No sources provided, skip memory extraction.' };
  }

  if (params.asyncTaskId && params.userIds[0]) {
    const cancelled = await getServerDB().then((db) =>
      new AsyncTaskModel(
        db,
        params.userIds[0]!,
        params.workspaceId,
      ).isUserMemoryExtractionCancellationRequested(params.asyncTaskId!),
    );
    if (cancelled) {
      return { message: 'Memory extraction task cancellation requested, skip processing users.' };
    }
  }

  const executor = await MemoryExtractionExecutor.create();
  const userCursor = params.userCursor
    ? { createdAt: new Date(params.userCursor.createdAt), id: params.userCursor.id }
    : undefined;

  const userBatch =
    params.userIds.length > 0
      ? { ids: params.userIds }
      : await executor.getUsers(USER_PAGE_SIZE, userCursor);

  const ids = userBatch.ids;
  if (ids.length === 0) {
    return { message: 'No users to process for memory extraction.' };
  }

  const cursor = 'cursor' in userBatch ? userBatch.cursor : undefined;

  for (const userIds of chunk(ids, USER_BATCH_SIZE)) {
    await MemoryExtractionWorkflowService.triggerProcessUserTopics({
      ...buildWorkflowPayloadInput(params),
      topicCursor: undefined,
      userId: userIds[0],
      userIds,
    });
  }

  if (params.userIds.length === 0 && cursor) {
    await MemoryExtractionWorkflowService.triggerProcessUsers({
      ...buildWorkflowPayloadInput({
        ...params,
        userCursor: serializeCursor(cursor),
      }),
    });
  }

  return {
    batches: Math.ceil(ids.length / USER_BATCH_SIZE),
    nextCursor: cursor ? cursor.id : null,
    processedUsers: ids.length,
  };
}

export async function runMemoryProcessUserTopics(raw: MemoryExtractionPayloadInput) {
  const params = normalizeMemoryExtractionPayload(raw || {});
  if (!params.userIds.length) {
    return { message: 'No user ids provided for topic processing.' };
  }
  if (!params.sources.includes(MemorySourceType.ChatTopic)) {
    return { message: 'No supported sources requested, skip topic processing.' };
  }

  const executor = await MemoryExtractionExecutor.create();
  let processedAny = false;

  for (const userId of params.userIds) {
    if (params.asyncTaskId) {
      const cancelled = await getServerDB().then((db) =>
        new AsyncTaskModel(
          db,
          userId,
          params.workspaceId,
        ).isUserMemoryExtractionCancellationRequested(params.asyncTaskId!),
      );
      if (cancelled) continue;
    }

    const topicCursor =
      params.topicCursor && params.topicCursor.userId === userId
        ? { createdAt: new Date(params.topicCursor.createdAt), id: params.topicCursor.id }
        : undefined;

    let topicsFromPayload: string[] | undefined;
    if (params.topicIds && params.topicIds.length > 0) {
      const filtered = await executor.filterTopicIdsForUser(
        userId,
        params.topicIds,
        params.workspaceId,
      );
      topicsFromPayload = filtered.length > 0 ? filtered : undefined;
    }

    const topicBatch =
      topicsFromPayload && topicsFromPayload.length > 0
        ? { ids: topicsFromPayload }
        : await executor.getTopicsForUser(
            {
              cursor: topicCursor,
              forceAll: params.forceAll,
              forceTopics: params.forceTopics,
              from: params.from,
              to: params.to,
              userId,
              workspaceId: params.workspaceId,
            },
            TOPIC_PAGE_SIZE,
          );

    const ids = topicBatch.ids;
    if (!ids.length) continue;
    processedAny = true;

    const cursor = 'cursor' in topicBatch ? topicBatch.cursor : undefined;
    const fanoutCount = params.topicFanoutCount ?? 0;
    const remainingBudget = topicsFromPayload
      ? ids.length
      : Math.max(0, MAX_TOPICS_PER_USER_PER_RUN - fanoutCount);
    const idsToProcess = topicsFromPayload ? ids : ids.slice(0, remainingBudget);

    for (const topicIds of chunk(idsToProcess, TOPIC_BATCH_SIZE)) {
      await MemoryExtractionWorkflowService.triggerProcessTopics(userId, {
        ...buildWorkflowPayloadInput(params),
        topicCursor: undefined,
        topicIds,
        userId,
        userIds: [userId],
      });
    }

    const nextFanoutCount = fanoutCount + idsToProcess.length;
    if (!topicsFromPayload && cursor && nextFanoutCount < MAX_TOPICS_PER_USER_PER_RUN) {
      const createdAt = new Date(cursor.createdAt);
      if (Number.isNaN(createdAt.getTime())) {
        throw new Error('Invalid cursor date when scheduling next topic page');
      }
      await MemoryExtractionWorkflowService.triggerProcessUserTopics({
        ...buildWorkflowPayloadInput({
          ...params,
          topicCursor: {
            createdAt: createdAt.toISOString(),
            id: cursor.id,
            userId,
          },
          topicFanoutCount: nextFanoutCount,
          topicIds: [],
          userId,
          userIds: [userId],
        }),
      });
    }
  }

  // User-initiated tasks stay Pending until a topic increments progress.
  if (
    !processedAny &&
    params.userInitiated &&
    params.asyncTaskId &&
    !params.topicCursor &&
    params.userIds[0]
  ) {
    await getServerDB().then((db) =>
      new AsyncTaskModel(db, params.userIds[0]!, params.workspaceId).update(params.asyncTaskId!, {
        status: AsyncTaskStatus.Success,
      }),
    );
  }

  return { processedUsers: params.userIds.length };
}

export async function runMemoryProcessTopics(raw: MemoryExtractionPayloadInput) {
  const payload = normalizeMemoryExtractionPayload(raw || {});
  if (!payload.userIds.length || !payload.topicIds.length) {
    return { message: 'Missing user or topic ids', processedTopics: 0 };
  }
  if (!payload.sources.includes(MemorySourceType.ChatTopic)) {
    return { message: 'Source not supported', processedTopics: 0 };
  }

  const userId = payload.userIds[0]!;
  if (payload.asyncTaskId) {
    const cancelled = await getServerDB().then((db) =>
      new AsyncTaskModel(
        db,
        userId,
        payload.workspaceId,
      ).isUserMemoryExtractionCancellationRequested(payload.asyncTaskId!),
    );
    if (cancelled) {
      return { message: 'Cancellation requested', processedTopics: 0 };
    }
  }

  for (const topicId of payload.topicIds) {
    await MemoryExtractionWorkflowService.triggerProcessTopic(userId, {
      ...buildWorkflowPayloadInput(payload),
      topicIds: [topicId],
      userId,
      userIds: [userId],
    });
  }

  return { processedTopics: payload.topicIds.length, processedUsers: 1 };
}

export async function runMemoryProcessTopic(raw: MemoryExtractionPayloadInput) {
  const payload = normalizeMemoryExtractionPayload(raw || {});
  const topicId = payload.topicIds[0];
  const userId = payload.userIds[0];
  if (!userId || !topicId) {
    return { message: 'Missing userId or topicId for topic job.' };
  }
  if (!payload.sources.includes(MemorySourceType.ChatTopic)) {
    return { message: 'Source not supported in topic job.' };
  }

  const executor = await MemoryExtractionExecutor.create();

  if (payload.asyncTaskId) {
    const cancelled = await getServerDB().then((db) =>
      new AsyncTaskModel(
        db,
        userId,
        payload.workspaceId,
      ).isUserMemoryExtractionCancellationRequested(payload.asyncTaskId!),
    );
    if (cancelled) {
      return { message: 'Memory extraction task cancellation requested, skip topic.' };
    }
  }

  let cepaLayers = CEPA_LAYERS;
  if (payload.layers.length) {
    cepaLayers = payload.layers.filter((layer) => CEPA_LAYERS.includes(layer));
  }
  await executor.extractTopic({
    asyncTaskId: payload.asyncTaskId,
    forceAll: payload.forceAll,
    forceTopics: payload.forceTopics,
    from: payload.from,
    layers: cepaLayers,
    reportProgress: false,
    source: MemorySourceType.ChatTopic,
    to: payload.to,
    topicId,
    userId,
    userInitiated: payload.userInitiated,
    workspaceId: payload.workspaceId,
  });

  if (payload.asyncTaskId) {
    const cancelled = await getServerDB().then((db) =>
      new AsyncTaskModel(
        db,
        userId,
        payload.workspaceId,
      ).isUserMemoryExtractionCancellationRequested(payload.asyncTaskId!),
    );
    if (cancelled) {
      return { message: 'Cancelled before identity extraction.', topicId, userId };
    }
  }

  let identityLayers = IDENTITY_LAYERS;
  if (payload.layers.length) {
    identityLayers = payload.layers.filter((layer) => IDENTITY_LAYERS.includes(layer));
  }
  await executor.extractTopic({
    asyncTaskId: payload.asyncTaskId,
    forceAll: payload.forceAll,
    forceTopics: payload.forceTopics,
    from: payload.from,
    layers: identityLayers,
    reportProgress: false,
    source: MemorySourceType.ChatTopic,
    to: payload.to,
    topicId,
    userId,
    userInitiated: payload.userInitiated,
    workspaceId: payload.workspaceId,
  });

  if (payload.asyncTaskId && payload.userInitiated) {
    await getServerDB().then((db) =>
      new AsyncTaskModel(db, userId, payload.workspaceId).incrementUserMemoryExtractionProgress(
        payload.asyncTaskId!,
      ),
    );
  }

  return { processedTopics: 1, processedUsers: 1, topicId, userId };
}

export async function runMemoryHourly(raw: MemoryExtractionHourlyWorkflowPayload) {
  const { cursor, dryRun } = raw || {};
  const baseUrl = raw?.baseUrl || process.env.APP_URL || 'http://localhost';
  const executor = await MemoryExtractionExecutor.create();

  const parsedCursor = cursor
    ? { createdAt: new Date(cursor.createdAt), id: cursor.id }
    : undefined;
  if (parsedCursor && Number.isNaN(parsedCursor.createdAt.getTime())) {
    throw new Error('Invalid cursor date for hourly memory extraction');
  }

  const userBatch = await executor.getUsersForHourlyExtraction(HOURLY_USER_PAGE, parsedCursor);
  const userIds = userBatch.ids;
  if (userIds.length === 0) {
    return { message: 'No eligible users for hourly memory extraction.', processedUsers: 0 };
  }

  const nextCursor = userBatch.cursor ? serializeCursor(userBatch.cursor) : undefined;

  if (!dryRun) {
    for (const batchUserIds of chunk(userIds, HOURLY_USER_BATCH)) {
      await MemoryExtractionWorkflowService.triggerProcessUsers(
        buildWorkflowPayloadInput(
          normalizeMemoryExtractionPayload({
            baseUrl,
            mode: 'workflow',
            sources: [MemorySourceType.ChatTopic],
            userIds: batchUserIds,
          }),
        ),
      );
    }
  }

  if (nextCursor) {
    await MemoryExtractionWorkflowService.triggerHourly({
      baseUrl,
      cursor: nextCursor,
      dryRun,
    });
  }

  return {
    dryRun: !!dryRun,
    hasNextPage: !!nextCursor,
    processedUsers: userIds.length,
    scheduledBatches: dryRun ? 0 : Math.ceil(userIds.length / HOURLY_USER_BATCH),
  };
}

export interface MemoryDailyJobPayload {
  baseUrl?: string;
  /** ISO day key YYYY-MM-DD in the configured timezone (for logging / idempotency). */
  dayKey?: string;
  dryRun?: boolean;
  /** Inclusive range for "conversations today". */
  from?: string;
  to?: string;
}

/**
 * Daily memory analysis: only users with ≥1 user message in [from, to] are processed.
 * Topics extracted are limited to that same window via fromDate/toDate.
 */
export async function runMemoryDaily(raw: MemoryDailyJobPayload = {}) {
  const baseUrl = raw.baseUrl || process.env.APP_URL || 'http://localhost';
  const from = raw.from ? new Date(raw.from) : undefined;
  const to = raw.to ? new Date(raw.to) : undefined;
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error('memory.daily requires valid from/to ISO timestamps');
  }

  const dryRun = !!raw.dryRun;
  const executor = await MemoryExtractionExecutor.create();
  let totalUsers = 0;
  let scheduledBatches = 0;
  let cursor: { createdAt: Date; id: string } | undefined;

  // Page through all eligible users (memory on + message activity today).
  for (;;) {
    const page = await executor.getUsersForHourlyExtraction(HOURLY_USER_PAGE, cursor, {
      from,
      until: to,
    });
    if (page.ids.length === 0) break;

    totalUsers += page.ids.length;

    if (!dryRun) {
      for (const batchUserIds of chunk(page.ids, HOURLY_USER_BATCH)) {
        await MemoryExtractionWorkflowService.triggerProcessUsers(
          buildWorkflowPayloadInput(
            normalizeMemoryExtractionPayload({
              baseUrl,
              fromDate: from,
              mode: 'workflow',
              sources: [MemorySourceType.ChatTopic],
              toDate: to,
              userIds: batchUserIds,
              userInitiated: false,
            }),
          ),
        );
        scheduledBatches += 1;
      }
    }

    if (!page.cursor) break;
    cursor = page.cursor;
  }

  if (totalUsers === 0) {
    return {
      dayKey: raw.dayKey,
      dryRun,
      message: 'No users with conversations in the daily window; skip analysis.',
      processedUsers: 0,
      scheduledBatches: 0,
    };
  }

  return {
    dayKey: raw.dayKey,
    dryRun,
    from: from.toISOString(),
    processedUsers: totalUsers,
    scheduledBatches: dryRun ? 0 : scheduledBatches,
    to: to.toISOString(),
  };
}

export async function runMemoryPersonaUpdate(raw: { userIds?: string[] }) {
  const userIds = Array.from(new Set(raw?.userIds || [])).filter(Boolean);
  if (userIds.length === 0) {
    throw new Error('No user IDs provided for persona update.');
  }

  const db = await getServerDB();
  const service = new UserPersonaService(db);

  for (const userId of userIds) {
    const jobInput = await buildUserPersonaJobInput(db, userId);
    await service.composeWriting({ ...jobInput, userId });
  }

  return { message: 'User persona processed via internal job.', processedUsers: userIds.length };
}
