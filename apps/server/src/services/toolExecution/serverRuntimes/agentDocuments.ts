import type { DocumentLoadRule } from '@lobechat/agent-templates';
import {
  AgentDocumentsIdentifier,
  buildAgentDocumentUrl,
} from '@lobechat/builtin-tool-agent-documents';
import { AgentDocumentsExecutionRuntime } from '@lobechat/builtin-tool-agent-documents/executionRuntime';
import { eq } from 'drizzle-orm';

import { TaskModel } from '@/database/models/task';
import { WorkspaceModel } from '@/database/models/workspace';
import { tasks } from '@/database/schemas';
import { appEnv } from '@/envs/app';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { emitAgentDocumentToolOutcomeSafely } from '@/server/services/agentDocuments/toolOutcome';

import { type ServerRuntimeRegistration } from './types';

const TOOL_RESULTS_ARCHIVE_FILENAME = '.tool-results';

const getAgentDocumentAppUrl = (): string | undefined => {
  try {
    return appEnv.APP_URL;
  } catch {
    return process.env.APP_URL;
  }
};

export const agentDocumentsRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Agent Documents execution');
    }

    const db = context.serverDB;
    const userId = context.userId;
    const service = new AgentDocumentsService(
      db,
      userId,
      context.workspaceId,
      context.agentVisibility,
    );
    const enabledDocumentIds = new Set(context.enabledAgentDocumentIds ?? []);
    const runtimeCreatedDocumentIds = new Set<string>();
    let archiveFolderIdsPromise: Promise<Set<string>> | undefined;

    const getArchiveFolderIds = (agentId: string) => {
      archiveFolderIdsPromise ??= service
        .listDocuments(agentId, 'all', { includeArchivedToolResults: true })
        .then(
          (docs) =>
            new Set(
              docs
                .filter((doc) => doc.filename === TOOL_RESULTS_ARCHIVE_FILENAME && !doc.parentId)
                .map((doc) => doc.documentId),
            ),
        );

      return archiveFolderIdsPromise;
    };

    const canUseDocument = async (
      agentId: string,
      doc: {
        documentId?: string;
        id: string;
        parentId?: string | null;
        templateId?: string | null;
      },
    ) => {
      if (doc.templateId) return true;
      if (enabledDocumentIds.has(doc.id) || runtimeCreatedDocumentIds.has(doc.id)) return true;
      if (context.documentId && doc.documentId === context.documentId) return true;

      const archiveFolderIds = await getArchiveFolderIds(agentId);
      return (
        (!!doc.documentId && archiveFolderIds.has(doc.documentId)) ||
        (!!doc.parentId && archiveFolderIds.has(doc.parentId))
      );
    };

    const getUsableDocument = async (agentId: string, id: string) => {
      const doc = await service.getDocumentById(id, agentId);
      if (!doc || !(await canUseDocument(agentId, doc))) return undefined;
      return doc;
    };

    const trackCreatedDocument = <T extends { id?: string } | undefined>(doc: T): T => {
      if (doc?.id) runtimeCreatedDocumentIds.add(doc.id);
      return doc;
    };
    const { taskId } = context;
    let workspaceSlugPromise: Promise<string | undefined> | undefined;
    const emitDocumentOutcome = async (input: {
      agentId?: string;
      agentDocumentId?: string;
      apiName: string;
      errorReason?: string;
      hintIsSkill?: boolean;
      relation?: string;
      status: 'failed' | 'succeeded';
      summary: string;
      toolAction: string;
    }) => {
      await emitAgentDocumentToolOutcomeSafely({
        agentDocumentId: input.agentDocumentId,
        agentId: input.agentId ?? context.agentId,
        apiName: input.apiName,
        errorReason: input.errorReason,
        hintIsSkill: input.hintIsSkill,
        messageId: context.messageId,
        operationId: context.operationId,
        relation: input.relation,
        status: input.status,
        summary: input.summary,
        taskId: context.taskId,
        toolAction: input.toolAction,
        toolCallId: context.toolCallId,
        topicId: context.topicId,
        userId,
      });
    };

    const withDocumentOutcome = async <T>(
      input: {
        agentId?: string;
        getAgentDocumentId?: (result: T) => string | undefined;
        apiName: string;
        hintIsSkill?: boolean;
        relation: string;
        summary: string;
        toolAction: string;
      },
      operation: () => Promise<T>,
    ) => {
      try {
        const result = await operation();
        await emitDocumentOutcome({
          agentId: input.agentId,
          agentDocumentId: input.getAgentDocumentId?.(result),
          apiName: input.apiName,
          hintIsSkill: input.hintIsSkill,
          relation: input.relation,
          status: 'succeeded',
          summary: input.summary,
          toolAction: input.toolAction,
        });
        return result;
      } catch (error) {
        await emitDocumentOutcome({
          agentId: input.agentId,
          apiName: input.apiName,
          errorReason: (error as Error).message,
          hintIsSkill: input.hintIsSkill,
          relation: input.relation,
          status: 'failed',
          summary: `${input.summary} failed.`,
          toolAction: input.toolAction,
        });
        throw error;
      }
    };

    const pinToTask = async <T extends { documentId?: string } | undefined>(doc: T): Promise<T> => {
      if (taskId && doc?.documentId) {
        // Prefer the workspaceId already threaded through the pipeline; fall
        // back to the owning task row for legacy callers.
        let wsId = context.workspaceId;
        if (!wsId) {
          const [row] = await db
            .select({ workspaceId: tasks.workspaceId })
            .from(tasks)
            .where(eq(tasks.id, taskId))
            .limit(1);
          wsId = row?.workspaceId ?? undefined;
        }
        const taskModel = new TaskModel(db, userId, wsId);
        await taskModel.pinDocument(taskId, doc.documentId, 'agent');
      }
      return doc;
    };

    const resolveWorkspaceSlugForUrl = async (): Promise<string | undefined> => {
      if (!context.workspaceId) return undefined;

      workspaceSlugPromise ??= new WorkspaceModel(db, userId)
        .findById(context.workspaceId)
        .then((workspace) => workspace?.slug)
        .catch((error) => {
          console.error('[agentDocumentsRuntime] Failed to resolve workspace slug:', error);
          return undefined;
        });

      return workspaceSlugPromise;
    };

    return new AgentDocumentsExecutionRuntime(
      {
        copyDocument: async ({ agentId, id, newTitle }) => {
          if (!(await getUsableDocument(agentId, id))) return undefined;

          return trackCreatedDocument(
            await pinToTask(
              await withDocumentOutcome(
                {
                  agentId,
                  apiName: 'copyDocument',
                  getAgentDocumentId: (result) => result?.id,
                  relation: 'created',
                  summary: 'Agent documents copied a document.',
                  toolAction: 'copy',
                },
                () => service.copyDocumentById(id, newTitle, agentId),
              ),
            ),
          );
        },
        createDocument: async ({ agentId, content, hintIsSkill, title }) =>
          trackCreatedDocument(
            await pinToTask(
              await withDocumentOutcome(
                {
                  agentId,
                  apiName: 'createDocument',
                  getAgentDocumentId: (result) => result?.id,
                  hintIsSkill,
                  relation: 'created',
                  summary: 'Agent documents created a document.',
                  toolAction: 'create',
                },
                () => service.createDocument(agentId, title, content, { hintIsSkill }),
              ),
            ),
          ),
        createTopicDocument: async ({ agentId, content, hintIsSkill, title, topicId }) =>
          trackCreatedDocument(
            await pinToTask(
              await withDocumentOutcome(
                {
                  agentId,
                  apiName: 'createTopicDocument',
                  getAgentDocumentId: (result) => result?.id,
                  hintIsSkill,
                  relation: 'created',
                  summary: 'Agent documents created a topic document.',
                  toolAction: 'create',
                },
                () => service.createForTopic(agentId, title, content, topicId, { hintIsSkill }),
              ),
            ),
          ),
        listDocuments: async ({ agentId, parentId, sourceType }) => {
          // Archived tool results remain available as internal context receipts; user-created
          // resource documents require an explicit attachment selection.
          const docs = await service.listDocuments(agentId, sourceType, {
            includeArchivedToolResults: true,
            parentId,
          });
          const scopedDocs = (
            await Promise.all(
              docs.map(async (doc) => ((await canUseDocument(agentId, doc)) ? doc : undefined)),
            )
          ).filter((doc): doc is NonNullable<typeof doc> => !!doc);
          return scopedDocs.map((d) => ({
            documentId: d.documentId,
            filename: d.filename,
            id: d.id,
            title: d.title,
          }));
        },
        listTopicDocuments: async ({ agentId, parentId, sourceType, topicId }) => {
          const docs = await service.listDocumentsForTopic(agentId, topicId, sourceType, {
            includeArchivedToolResults: true,
          });
          const filtered = parentId ? docs.filter((d) => d.parentId === parentId) : docs;
          const scopedDocs = (
            await Promise.all(
              filtered.map(async (doc) => ((await canUseDocument(agentId, doc)) ? doc : undefined)),
            )
          ).filter((doc): doc is NonNullable<typeof doc> => !!doc);
          return scopedDocs.map((d) => ({
            documentId: d.documentId,
            filename: d.filename,
            id: d.id,
            title: d.title,
          }));
        },
        modifyNodes: async ({ agentId, id, operations }) => {
          if (!(await getUsableDocument(agentId, id))) return undefined;

          return withDocumentOutcome(
            {
              agentId,
              apiName: 'modifyNodes',
              getAgentDocumentId: () => id,
              relation: 'updated',
              summary: 'Agent documents modified document nodes.',
              toolAction: 'edit',
            },
            () => service.modifyDocumentNodesById(id, operations, agentId),
          );
        },
        readDocument: async ({ agentId, id }) => {
          if (!(await getUsableDocument(agentId, id))) return undefined;
          return service.getDocumentSnapshotById(id, agentId);
        },
        removeDocument: async ({ agentId, id }) => {
          if (!(await getUsableDocument(agentId, id))) return false;

          return withDocumentOutcome(
            {
              agentId,
              apiName: 'removeDocument',
              getAgentDocumentId: () => id,
              relation: 'removed',
              summary: 'Agent documents removed a document.',
              toolAction: 'remove',
            },
            () => service.removeDocumentById(id, agentId),
          );
        },
        renameDocument: async ({ agentId, id, newTitle }) => {
          if (!(await getUsableDocument(agentId, id))) return undefined;

          return withDocumentOutcome(
            {
              agentId,
              apiName: 'renameDocument',
              getAgentDocumentId: () => id,
              relation: 'updated',
              summary: 'Agent documents renamed a document.',
              toolAction: 'rename',
            },
            () => service.renameDocumentById(id, newTitle, agentId),
          );
        },
        replaceDocumentContent: async ({ agentId, content, id }) => {
          if (!(await getUsableDocument(agentId, id))) return undefined;

          return withDocumentOutcome(
            {
              agentId,
              apiName: 'replaceDocumentContent',
              getAgentDocumentId: () => id,
              relation: 'updated',
              summary: 'Agent documents replaced document content.',
              toolAction: 'replace',
            },
            () => service.replaceDocumentContentById(id, content, agentId),
          );
        },
        updateLoadRule: async ({ agentId, id, rule }) => {
          if (!(await getUsableDocument(agentId, id))) return undefined;

          return withDocumentOutcome(
            {
              agentId,
              apiName: 'updateLoadRule',
              getAgentDocumentId: () => id,
              relation: 'updated',
              summary: 'Agent documents updated a load rule.',
              toolAction: 'update',
            },
            () =>
              service.updateLoadRuleById(
                id,
                { ...rule, rule: rule.rule as DocumentLoadRule | undefined },
                agentId,
              ),
          );
        },
      },
      {
        getDocumentUrl: async ({ agentId, documentId }) => {
          const workspaceSlug = await resolveWorkspaceSlugForUrl();
          if (context.workspaceId && !workspaceSlug) return undefined;

          return buildAgentDocumentUrl(getAgentDocumentAppUrl(), agentId, documentId, {
            workspaceSlug,
          });
        },
      },
    );
  },
  identifier: AgentDocumentsIdentifier,
};
