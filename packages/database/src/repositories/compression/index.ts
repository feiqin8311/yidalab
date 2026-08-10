import type { CompressionGroupMetadata } from '@lobechat/types';
import { MessageGroupType } from '@lobechat/types';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { MessageGroupItem } from '../../schemas';
import { messageGroups, messages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

export interface CreateCompressionGroupParams {
  content: string;
  editorData?: any;
  messageIds: string[];
  metadata: CompressionGroupMetadata;
  topicId: string;
}

export interface CompressionGroupResult {
  content: string | null;
  createdAt: Date;
  description: string | null;
  editorData: unknown;
  id: string;
  metadata: CompressionGroupMetadata | null;
  topicId: string | null;
  type: string | null;
}

/**
 * Compression Repository - handles message compression operations
 */
export class CompressionRepository {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private groupsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messageGroups);

  private messagesOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages);

  /**
   * Create a compression group and mark messages as compressed.
   * Only messages already belonging to `topicId` are attached (cross-topic rejected).
   */
  async createCompressionGroup(params: CreateCompressionGroupParams): Promise<string> {
    const { topicId, content, editorData, messageIds, metadata } = params;

    // Store metadata in the description field as JSON string
    const description = JSON.stringify(metadata);

    // 1. Create compression group
    const result = (await this.db
      .insert(messageGroups)
      .values({
        content,
        description,
        editorData,
        topicId,
        type: MessageGroupType.Compression,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })
      .returning()) as MessageGroupItem[];

    const group = result[0];

    // 2. Mark messages as compressed — scoped to this topic only
    if (messageIds.length > 0) {
      await this.markMessagesAsCompressed(messageIds, group.id, topicId);
    }

    return group.id;
  }

  /**
   * Get all compression groups for a topic
   */
  async getCompressionGroups(topicId: string): Promise<CompressionGroupResult[]> {
    const groups = await this.db
      .select()
      .from(messageGroups)
      .where(
        and(
          this.groupsOwnership(),
          eq(messageGroups.topicId, topicId),
          eq(messageGroups.type, MessageGroupType.Compression),
        ),
      )
      .orderBy(messageGroups.createdAt);

    // Parse description field as metadata
    return groups.map((group) => ({
      ...group,
      metadata: group.description ? JSON.parse(group.description) : null,
    })) as unknown as CompressionGroupResult[];
  }

  /**
   * Get the latest compression group for a topic
   */
  async getLatestCompressionGroup(topicId: string): Promise<CompressionGroupResult | null> {
    const groups = await this.getCompressionGroups(topicId);
    return groups.length > 0 ? groups.at(-1)! : null;
  }

  /**
   * Update compression group content
   */
  async updateCompressionContent(
    groupId: string,
    content: string,
    metadata?: Partial<CompressionGroupMetadata>,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      content,
      updatedAt: new Date(),
    };

    if (metadata) {
      // Need to merge with existing metadata
      const existing = await this.db
        .select({ description: messageGroups.description })
        .from(messageGroups)
        .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));

      const existingMetadata = existing[0]?.description ? JSON.parse(existing[0].description) : {};
      updateData.description = JSON.stringify({ ...existingMetadata, ...metadata });
    }

    await this.db
      .update(messageGroups)
      .set(updateData)
      .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));
  }

  /**
   * Update compression group metadata (UI state like expanded)
   */
  async updateMetadata(
    groupId: string,
    metadata: Partial<CompressionGroupMetadata>,
  ): Promise<void> {
    // Get existing metadata and merge
    const existing = await this.db
      .select({ metadata: messageGroups.metadata })
      .from(messageGroups)
      .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));

    const existingData = (existing[0]?.metadata as Record<string, unknown>) || {};
    const newMetadata = { ...existingData, ...metadata };

    await this.db
      .update(messageGroups)
      .set({ metadata: newMetadata, updatedAt: new Date() })
      .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));
  }

  /**
   * Mark messages as compressed by associating them with a compression group.
   * When `topicId` is set, only messages in that topic are updated.
   */
  async markMessagesAsCompressed(
    messageIds: string[],
    groupId: string,
    topicId?: string,
  ): Promise<void> {
    if (messageIds.length === 0) return;

    await this.db
      .update(messages)
      .set({ messageGroupId: groupId })
      .where(
        and(
          this.messagesOwnership(),
          ...(topicId ? [eq(messages.topicId, topicId)] : []),
          inArray(messages.id, messageIds),
        ),
      );
  }

  /**
   * Unmark messages from compression (remove from compression group)
   */
  async unmarkMessagesFromCompression(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;

    await this.db
      .update(messages)
      .set({ messageGroupId: null })
      .where(and(this.messagesOwnership(), inArray(messages.id, messageIds)));
  }

  /**
   * Toggle pin status for a message
   */
  async toggleMessagePin(messageId: string, pinned: boolean): Promise<void> {
    // Get current metadata
    const [message] = await this.db
      .select({ metadata: messages.metadata })
      .from(messages)
      .where(and(eq(messages.id, messageId), this.messagesOwnership()));

    if (!message) return;

    const currentMetadata = (message.metadata as Record<string, unknown>) || {};
    const newMetadata = { ...currentMetadata, pinned };

    await this.db
      .update(messages)
      .set({ metadata: newMetadata })
      .where(and(eq(messages.id, messageId), this.messagesOwnership()));
  }

  /**
   * Get messages that are not compressed (for sending to LLM)
   */
  async getUncompressedMessages(topicId: string) {
    return this.db
      .select()
      .from(messages)
      .where(
        and(
          this.messagesOwnership(),
          eq(messages.topicId, topicId),
          isNull(messages.messageGroupId),
        ),
      )
      .orderBy(messages.createdAt);
  }

  /**
   * Get compressed messages for a specific compression group
   */
  async getCompressedMessages(groupId: string) {
    return this.db
      .select()
      .from(messages)
      .where(and(this.messagesOwnership(), eq(messages.messageGroupId, groupId)))
      .orderBy(messages.createdAt);
  }

  /**
   * Delete a compression group and unmark all associated messages.
   * When `topicId` is set, the group must belong to that topic or the call is a no-op / error.
   */
  async deleteCompressionGroup(groupId: string, topicId?: string): Promise<void> {
    if (topicId) {
      const [group] = await this.db
        .select({ id: messageGroups.id, topicId: messageGroups.topicId })
        .from(messageGroups)
        .where(
          and(
            eq(messageGroups.id, groupId),
            this.groupsOwnership(),
            eq(messageGroups.type, MessageGroupType.Compression),
          ),
        );
      if (!group || group.topicId !== topicId) {
        throw new Error(`Compression group not found in topic: ${groupId}`);
      }
    }

    // 1. Unmark all messages (optionally topic-scoped)
    await this.db
      .update(messages)
      .set({ messageGroupId: null })
      .where(
        and(
          this.messagesOwnership(),
          eq(messages.messageGroupId, groupId),
          ...(topicId ? [eq(messages.topicId, topicId)] : []),
        ),
      );

    // 2. Delete the group
    await this.db
      .delete(messageGroups)
      .where(
        and(
          eq(messageGroups.id, groupId),
          this.groupsOwnership(),
          ...(topicId ? [eq(messageGroups.topicId, topicId)] : []),
        ),
      );
  }

  /**
   * Atomically commit a rolling compression checkpoint:
   * - write content + metadata (description + metadata jsonb)
   * - reassign all messageIds to the checkpoint group
   * - delete merged prior compression groups (without unmarking — messages already reassigned)
   *
   * Does not run until model output is ready; call only after validation succeeds.
   */
  async commitCompressionCheckpoint(params: {
    content: string;
    groupId: string;
    mergeGroupIds?: string[];
    messageIds?: string[];
    metadata?: Partial<CompressionGroupMetadata>;
    /** Required session boundary — messages/groups outside this topic are rejected. */
    topicId: string;
  }): Promise<void> {
    const { content, groupId, mergeGroupIds = [], messageIds = [], metadata, topicId } = params;

    await this.db.transaction(async (tx) => {
      // 1. Load target group and enforce topic scope
      const existing = await tx
        .select({
          description: messageGroups.description,
          metadata: messageGroups.metadata,
          topicId: messageGroups.topicId,
          type: messageGroups.type,
        })
        .from(messageGroups)
        .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));

      if (!existing[0]) {
        throw new Error(`Compression group not found: ${groupId}`);
      }
      if (existing[0].topicId !== topicId) {
        throw new Error(`Compression group topic mismatch: ${groupId}`);
      }
      if (existing[0].type !== MessageGroupType.Compression) {
        throw new Error(`Not a compression group: ${groupId}`);
      }

      const existingDescriptionMeta = existing[0].description
        ? (JSON.parse(existing[0].description) as Record<string, unknown>)
        : {};
      const existingMetadataCol = (existing[0].metadata as Record<string, unknown> | null) || {};

      const mergedMeta: CompressionGroupMetadata = {
        ...existingDescriptionMeta,
        ...existingMetadataCol,
        ...metadata,
      } as CompressionGroupMetadata;

      const descriptionPayload = { ...mergedMeta };
      await tx
        .update(messageGroups)
        .set({
          content,
          description: JSON.stringify(descriptionPayload),
          metadata: mergedMeta as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(and(eq(messageGroups.id, groupId), this.groupsOwnership()));

      // 2. Reassign this-pass message ids — only messages already in this topic
      if (messageIds.length > 0) {
        await tx
          .update(messages)
          .set({ messageGroupId: groupId })
          .where(
            and(
              this.messagesOwnership(),
              eq(messages.topicId, topicId),
              inArray(messages.id, messageIds),
            ),
          );
      }

      // 3. ALWAYS migrate every message still under merge groups BEFORE delete.
      // messageGroupId has ON DELETE CASCADE — deleting a group without moving
      // its children physically deletes historical originals.
      const toDelete = mergeGroupIds.filter((id) => id && id !== groupId);
      if (toDelete.length > 0) {
        // Only merge compression groups that belong to the same topic
        const scopedMerge = await tx
          .select({ id: messageGroups.id })
          .from(messageGroups)
          .where(
            and(
              this.groupsOwnership(),
              eq(messageGroups.topicId, topicId),
              eq(messageGroups.type, MessageGroupType.Compression),
              inArray(messageGroups.id, toDelete),
            ),
          );
        const scopedIds = scopedMerge.map((g) => g.id);
        if (scopedIds.length === 0) {
          // nothing safe to merge/delete
        } else {
          await tx
            .update(messages)
            .set({ messageGroupId: groupId })
            .where(
              and(
                this.messagesOwnership(),
                eq(messages.topicId, topicId),
                inArray(messages.messageGroupId, scopedIds),
              ),
            );

          await tx
            .delete(messageGroups)
            .where(
              and(
                this.groupsOwnership(),
                eq(messageGroups.topicId, topicId),
                eq(messageGroups.type, MessageGroupType.Compression),
                inArray(messageGroups.id, scopedIds),
              ),
            );
        }
      }
    });
  }
}
