// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { agentDocumentsRuntime } from './agentDocuments';

const getDocumentById = vi.fn();
const getDocumentSnapshotById = vi.fn();
const listDocuments = vi.fn();

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn().mockImplementation(() => ({
    getDocumentById,
    getDocumentSnapshotById,
    listDocuments,
  })),
}));
vi.mock('@/server/services/agentDocuments/toolOutcome', () => ({
  emitAgentDocumentToolOutcomeSafely: vi.fn(),
}));

describe('agentDocumentsRuntime', () => {
  describe('listDocuments', () => {
    it('should preserve document filenames in runtime output', async () => {
      listDocuments.mockResolvedValue([
        { filename: 'rules.md', id: 'doc-1', title: 'Rules' },
        { filename: 'notes.txt', id: 'doc-2', title: 'Notes' },
      ]);

      const runtime = agentDocumentsRuntime.factory({
        enabledAgentDocumentIds: ['doc-1', 'doc-2'],
        serverDB: {} as never,
        toolManifestMap: {},
        userId: 'user-1',
      });
      const result = await runtime.listDocuments({}, { agentId: 'agent-1' });

      // The agent runtime opts into seeing the archived `.tool-results`.
      expect(listDocuments).toHaveBeenCalledWith('agent-1', 'all', {
        includeArchivedToolResults: true,
      });
      expect(result).toEqual({
        content: JSON.stringify([
          { filename: 'rules.md', id: 'doc-1', title: 'Rules' },
          { filename: 'notes.txt', id: 'doc-2', title: 'Notes' },
        ]),
        state: {
          documents: [
            { filename: 'rules.md', id: 'doc-1', title: 'Rules' },
            { filename: 'notes.txt', id: 'doc-2', title: 'Notes' },
          ],
        },
        success: true,
      });
    });

    it('hides user documents that were not explicitly attached', async () => {
      listDocuments.mockResolvedValue([
        {
          documentId: 'document-row-1',
          filename: 'private.md',
          id: 'doc-1',
          title: 'Private',
        },
      ]);

      const runtime = agentDocumentsRuntime.factory({
        serverDB: {} as never,
        toolManifestMap: {},
        userId: 'user-1',
      });
      const result = await runtime.listDocuments({}, { agentId: 'agent-1' });

      expect(result).toEqual({ content: '[]', state: { documents: [] }, success: true });
    });
  });

  describe('readDocument', () => {
    it('rejects a direct read when the document was not attached', async () => {
      getDocumentById.mockResolvedValue({
        documentId: 'document-row-1',
        id: 'doc-1',
        parentId: null,
        templateId: null,
      });
      listDocuments.mockResolvedValue([]);

      const runtime = agentDocumentsRuntime.factory({
        serverDB: {} as never,
        toolManifestMap: {},
        userId: 'user-1',
      });
      const result = await runtime.readDocument({ id: 'doc-1' }, { agentId: 'agent-1' });

      expect(result).toMatchObject({ content: 'Document not found: doc-1', success: false });
      expect(getDocumentSnapshotById).not.toHaveBeenCalled();
    });

    it('allows a direct read after the document is attached', async () => {
      getDocumentById.mockResolvedValue({
        documentId: 'document-row-1',
        id: 'doc-1',
        parentId: null,
        templateId: null,
      });
      getDocumentSnapshotById.mockResolvedValue({
        content: 'selected content',
        documentId: 'document-row-1',
        id: 'doc-1',
        title: 'Selected',
      });

      const runtime = agentDocumentsRuntime.factory({
        enabledAgentDocumentIds: ['doc-1'],
        serverDB: {} as never,
        toolManifestMap: {},
        userId: 'user-1',
      });
      const result = await runtime.readDocument({ id: 'doc-1' }, { agentId: 'agent-1' });

      expect(result).toMatchObject({ success: true });
      expect(getDocumentSnapshotById).toHaveBeenCalledWith('doc-1', 'agent-1');
    });
  });
});
