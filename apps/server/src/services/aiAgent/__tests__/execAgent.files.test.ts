import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockMessageCreate,
  mockCreateOperation,
  mockIngestAttachment,
  mockResolveAttachmentsByFileIds,
  mockFindByIds,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockFindByIds: vi.fn(),
  mockIngestAttachment: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockResolveAttachmentsByFileIds: vi.fn(),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
    getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue({
      chatConfig: {},
      files: [],
      id: 'agent-1',
      knowledgeBases: [],
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant',
    }),
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue({
      chatConfig: {},
      files: [],
      id: 'agent-1',
      knowledgeBases: [],
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant',
    }),
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(() => ({
    findByIds: mockFindByIds,
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: mockCreateOperation,
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(() => ({
    getComposioManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFileAccessUrl: vi
      .fn()
      .mockImplementation((file: { url: string }) =>
        Promise.resolve(`https://s3.example.com/${file.url}`),
      ),
    getFullFileUrl: vi
      .fn()
      .mockImplementation((key: string) => Promise.resolve(`https://s3.example.com/${key}`)),
  })),
}));

vi.mock('../ingestAttachment', () => ({
  ingestAttachment: mockIngestAttachment,
}));

vi.mock('@/server/services/file/resolveAttachments', () => ({
  resolveAttachmentsByFileIds: mockResolveAttachmentsByFileIds,
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getAllPluginManifests: vi.fn().mockReturnValue(new Map()),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        abilities: { functionCall: true, video: false, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
    ],
  };
});

const emptyResolved = {
  audioList: [] as any[],
  diagnostics: [] as any[],
  fileList: [] as any[],
  imageList: [] as any[],
  orderedFileIds: [] as string[],
  videoList: [] as any[],
  warnings: [] as string[],
};

describe('AiAgentService.execAgent - file upload handling', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockResolveAttachmentsByFileIds.mockResolvedValue({ ...emptyResolved });
    mockFindByIds.mockResolvedValue([]);

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('when files are provided', () => {
    it('should upload files to S3 and pass fileIds to messageModel.create', async () => {
      mockIngestAttachment.mockResolvedValue({
        fileId: 'file-abc',
        isImage: true,
        isVideo: false,
        key: 'files/test-user-id/xxx/photo.png',
        resolvedUrl: 'https://s3.example.com/files/test-user-id/xxx/photo.png',
      });
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolved,
        imageList: [
          {
            alt: 'photo.png',
            id: 'file-abc',
            url: 'https://s3.example.com/files/test-user-id/xxx/photo.png',
          },
        ],
        orderedFileIds: ['file-abc'],
      });

      await service.execAgent({
        agentId: 'agent-1',
        files: [
          {
            mimeType: 'image/png',
            name: 'photo.png',
            size: 12345,
            url: 'https://cdn.discordapp.com/attachments/123/456/photo.png',
          },
        ],
        prompt: 'What is in this image?',
      });

      expect(mockIngestAttachment).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'photo.png', mimeType: 'image/png' }),
        expect.any(Object),
        'test-user-id',
      );

      expect(mockResolveAttachmentsByFileIds).toHaveBeenCalledWith(
        expect.objectContaining({
          fileIds: ['file-abc'],
          writeMode: 'never',
        }),
      );

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toEqual(['file-abc']);
    });

    it('should include imageList in initialMessages for vision models', async () => {
      mockIngestAttachment.mockResolvedValue({
        fileId: 'file-img',
        isImage: true,
        isVideo: false,
        key: 'files/test-user-id/xxx/screenshot.jpg',
        resolvedUrl: 'https://s3.example.com/files/test-user-id/xxx/screenshot.jpg',
      });
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolved,
        imageList: [
          {
            alt: 'screenshot.jpg',
            id: 'file-img',
            url: 'https://s3.example.com/files/test-user-id/xxx/screenshot.jpg',
          },
        ],
        orderedFileIds: ['file-img'],
      });

      await service.execAgent({
        agentId: 'agent-1',
        files: [
          {
            mimeType: 'image/jpeg',
            name: 'screenshot.jpg',
            url: 'https://cdn.discordapp.com/attachments/123/456/screenshot.jpg',
          },
        ],
        prompt: 'Describe this screenshot',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      expect(lastMessage).toMatchObject({
        content: 'Describe this screenshot',
        id: 'msg-1',
        role: 'user',
      });
      expect(lastMessage.imageList).toEqual([
        {
          alt: 'screenshot.jpg',
          id: 'file-img',
          url: 'https://s3.example.com/files/test-user-id/xxx/screenshot.jpg',
        },
      ]);
    });

    it('should route videos to videoList instead of fileList', async () => {
      mockIngestAttachment.mockResolvedValue({
        fileId: 'file-vid',
        isImage: false,
        isVideo: true,
        key: 'files/test-user-id/xxx/clip.mp4',
        resolvedUrl: 'https://s3.example.com/files/test-user-id/xxx/clip.mp4',
      });
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolved,
        orderedFileIds: ['file-vid'],
        videoList: [
          {
            alt: 'clip.mp4',
            id: 'file-vid',
            url: 'https://s3.example.com/files/test-user-id/xxx/clip.mp4',
          },
        ],
      });

      await service.execAgent({
        agentId: 'agent-1',
        files: [
          {
            mimeType: 'video/mp4',
            name: 'clip.mp4',
            size: 67_890,
            url: 'https://cdn.discordapp.com/attachments/123/456/clip.mp4',
          },
        ],
        prompt: 'Describe this video',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      expect(lastMessage.imageList).toBeUndefined();
      expect(lastMessage.fileList).toBeUndefined();
      expect(lastMessage.videoList).toEqual([
        {
          alt: 'clip.mp4',
          id: 'file-vid',
          url: 'https://s3.example.com/files/test-user-id/xxx/clip.mp4',
        },
      ]);

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toEqual(['file-vid']);
    });

    it('should resolve non-image files via resolveAttachmentsByFileIds (not parseFile)', async () => {
      mockIngestAttachment.mockResolvedValue({
        fileId: 'file-pdf',
        isImage: false,
        isVideo: false,
        key: 'files/test-user-id/xxx/doc.pdf',
        resolvedUrl: '',
      });
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolved,
        fileList: [
          {
            content: 'parsed pdf body text',
            fileType: 'application/pdf',
            id: 'file-pdf',
            name: 'doc.pdf',
            parseStatus: 'ready',
            size: 4096,
            url: 'https://s3.example.com/files/test-user-id/xxx/doc.pdf',
          },
        ],
        orderedFileIds: ['file-pdf'],
      });

      await service.execAgent({
        agentId: 'agent-1',
        files: [
          {
            mimeType: 'application/pdf',
            name: 'doc.pdf',
            size: 4096,
            url: 'https://cdn.discordapp.com/attachments/123/456/doc.pdf',
          },
        ],
        prompt: 'Summarize this document',
      });

      expect(mockResolveAttachmentsByFileIds).toHaveBeenCalledWith(
        expect.objectContaining({
          fileIds: ['file-pdf'],
          writeMode: 'never',
        }),
      );

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      expect(lastMessage.imageList).toBeUndefined();
      expect(lastMessage.fileList).toEqual([
        {
          content: 'parsed pdf body text',
          fileType: 'application/pdf',
          id: 'file-pdf',
          name: 'doc.pdf',
          parseStatus: 'ready',
          size: 4096,
          url: 'https://s3.example.com/files/test-user-id/xxx/doc.pdf',
        },
      ]);
    });

    it('surfaces resolver empty-body placeholders when extract fails', async () => {
      mockIngestAttachment.mockResolvedValue({
        fileId: 'file-bin',
        isImage: false,
        isVideo: false,
        key: 'files/test-user-id/xxx/blob.bin',
        resolvedUrl: '',
      });
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolved,
        fileList: [
          {
            content:
              'Attachment id=file-bin name="blob.bin" could not provide inline text (no extractable text). Do not download/crawl the file URL (binary). REQUIRED: call lobe-files/inspectAttachment then lobe-files/readAttachment with this fileId.',
            fileType: 'application/octet-stream',
            id: 'file-bin',
            name: 'blob.bin',
            parseStatus: 'failed',
            size: 10,
            url: 'https://s3.example.com/files/test-user-id/xxx/blob.bin',
          },
        ],
        orderedFileIds: ['file-bin'],
        warnings: ['File "blob.bin" had no extractable text for the prompt.'],
      });

      await service.execAgent({
        agentId: 'agent-1',
        files: [
          {
            mimeType: 'application/octet-stream',
            name: 'blob.bin',
            size: 10,
            url: 'https://cdn.example/blob.bin',
          },
        ],
        prompt: 'What is in this?',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      expect(lastMessage.fileList?.[0]?.id).toBe('file-bin');
      expect(lastMessage.fileList?.[0]?.content).toContain('could not provide inline text');
    });
  });

  describe('when no files are provided', () => {
    it('should not call uploadFromUrl', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Hello',
      });

      expect(mockIngestAttachment).not.toHaveBeenCalled();
      expect(mockResolveAttachmentsByFileIds).not.toHaveBeenCalled();

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toBeUndefined();
    });
  });

  describe('when file upload fails', () => {
    it('should continue execution without the failed file', async () => {
      mockIngestAttachment.mockRejectedValue(new Error('Download failed'));

      await service.execAgent({
        agentId: 'agent-1',
        files: [
          {
            mimeType: 'image/png',
            name: 'broken.png',
            url: 'https://expired-cdn.example.com/broken.png',
          },
        ],
        prompt: 'What is this?',
      });

      expect(mockCreateOperation).toHaveBeenCalled();
      expect(mockResolveAttachmentsByFileIds).not.toHaveBeenCalled();

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toBeUndefined();
    });
  });

  // ─── Already-uploaded attachments (SPA Gateway mode) ───
  describe('when fileIds are provided (already-uploaded attachments)', () => {
    it('resolves image fileIds into imageList with full URLs and attaches them to the user message', async () => {
      mockFindByIds.mockResolvedValue([
        {
          fileType: 'image/png',
          id: 'file-img-1',
          name: 'photo.png',
          size: 2048,
          url: 'files/test-user-id/xxx/photo.png',
        },
      ]);
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolved,
        imageList: [
          {
            alt: 'photo.png',
            id: 'file-img-1',
            url: 'https://s3.example.com/files/test-user-id/xxx/photo.png',
          },
        ],
        orderedFileIds: ['file-img-1'],
      });

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-img-1'],
        prompt: 'What is in this image?',
      });

      expect(mockResolveAttachmentsByFileIds).toHaveBeenCalledWith(
        expect.objectContaining({
          fileIds: ['file-img-1'],
          writeMode: 'never',
        }),
      );

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toEqual(['file-img-1']);

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      expect(lastMessage.imageList).toEqual([
        {
          alt: 'photo.png',
          id: 'file-img-1',
          url: 'https://s3.example.com/files/test-user-id/xxx/photo.png',
        },
      ]);
      expect(lastMessage.videoList).toBeUndefined();
      expect(lastMessage.fileList).toBeUndefined();
    });

    it('parses document fileIds and populates fileList content via resolver', async () => {
      mockFindByIds.mockResolvedValue([
        {
          fileType: 'application/pdf',
          id: 'file-pdf-1',
          name: 'doc.pdf',
          size: 4096,
          url: 'files/test-user-id/xxx/doc.pdf',
        },
      ]);
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolved,
        fileList: [
          {
            content: 'parsed pdf body text',
            fileType: 'application/pdf',
            id: 'file-pdf-1',
            name: 'doc.pdf',
            parseStatus: 'ready',
            size: 4096,
            url: 'https://s3.example.com/files/test-user-id/xxx/doc.pdf',
          },
        ],
        orderedFileIds: ['file-pdf-1'],
      });

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-pdf-1'],
        prompt: 'Summarize this document',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      expect(lastMessage.imageList).toBeUndefined();
      expect(lastMessage.fileList).toEqual([
        {
          content: 'parsed pdf body text',
          fileType: 'application/pdf',
          id: 'file-pdf-1',
          name: 'doc.pdf',
          parseStatus: 'ready',
          size: 4096,
          url: 'https://s3.example.com/files/test-user-id/xxx/doc.pdf',
        },
      ]);
    });

    it('routes video fileIds into videoList (not imageList / fileList)', async () => {
      mockFindByIds.mockResolvedValue([
        {
          fileType: 'video/mp4',
          id: 'file-vid-1',
          name: 'clip.mp4',
          size: 67_890,
          url: 'files/test-user-id/xxx/clip.mp4',
        },
      ]);
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolved,
        orderedFileIds: ['file-vid-1'],
        videoList: [
          {
            alt: 'clip.mp4',
            id: 'file-vid-1',
            url: 'https://s3.example.com/files/test-user-id/xxx/clip.mp4',
          },
        ],
      });

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-vid-1'],
        prompt: 'Describe this clip',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      expect(lastMessage.imageList).toBeUndefined();
      expect(lastMessage.fileList).toBeUndefined();
      expect(lastMessage.videoList).toEqual([
        {
          alt: 'clip.mp4',
          id: 'file-vid-1',
          url: 'https://s3.example.com/files/test-user-id/xxx/clip.mp4',
        },
      ]);
    });

    it('preserves the caller-provided ordering of fileIds across classifications', async () => {
      mockFindByIds.mockResolvedValue([
        {
          fileType: 'application/pdf',
          id: 'file-pdf-1',
          name: 'b.pdf',
          size: 2,
          url: 'b.pdf',
        },
        {
          fileType: 'image/png',
          id: 'file-img-1',
          name: 'a.png',
          size: 1,
          url: 'a.png',
        },
      ]);
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolved,
        fileList: [
          {
            content: 'b-content',
            fileType: 'application/pdf',
            id: 'file-pdf-1',
            name: 'b.pdf',
            size: 2,
            url: 'https://s3.example.com/b.pdf',
          },
        ],
        imageList: [
          {
            alt: 'a.png',
            id: 'file-img-1',
            url: 'https://s3.example.com/a.png',
          },
        ],
        orderedFileIds: ['file-pdf-1', 'file-img-1'],
      });

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-pdf-1', 'file-img-1'],
        prompt: 'Mix of files',
      });

      expect(mockResolveAttachmentsByFileIds).toHaveBeenCalledWith(
        expect.objectContaining({ fileIds: ['file-pdf-1', 'file-img-1'] }),
      );

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toEqual(['file-pdf-1', 'file-img-1']);
    });

    it('skips missing file records with a warning instead of failing', async () => {
      mockFindByIds.mockResolvedValue([
        {
          fileType: 'image/png',
          id: 'file-img-1',
          name: 'ok.png',
          size: 1,
          url: 'ok.png',
        },
      ]);
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolved,
        imageList: [
          {
            alt: 'ok.png',
            id: 'file-img-1',
            url: 'https://s3.example.com/ok.png',
          },
        ],
        orderedFileIds: ['file-img-1'],
        warnings: ['Attachment "file-missing" was not found and skipped.'],
      });

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-img-1', 'file-missing'],
        prompt: 'Look at the good one',
      });

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toEqual(['file-img-1']);
      expect(mockCreateOperation).toHaveBeenCalled();
    });

    it('deduplicates repeated fileIds before inserting the messages_files link', async () => {
      mockFindByIds.mockResolvedValue([
        {
          fileType: 'image/png',
          id: 'file-img-1',
          name: 'photo.png',
          size: 1,
          url: 'photo.png',
        },
      ]);
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolved,
        imageList: [
          {
            alt: 'photo.png',
            id: 'file-img-1',
            url: 'https://s3.example.com/photo.png',
          },
        ],
        orderedFileIds: ['file-img-1'],
      });

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-img-1', 'file-img-1', 'file-img-1'],
        prompt: 'Triple duplicate',
      });

      // resolveRunAttachments dedupes before calling the resolver
      expect(mockResolveAttachmentsByFileIds).toHaveBeenCalledWith(
        expect.objectContaining({ fileIds: ['file-img-1'] }),
      );

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toEqual(['file-img-1']);

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);
      expect(lastMessage.imageList).toHaveLength(1);
    });

    it('no-ops cleanly when fileIds is an empty array', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        fileIds: [],
        prompt: 'Hello',
      });

      expect(mockResolveAttachmentsByFileIds).not.toHaveBeenCalled();
      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toBeUndefined();
    });

    it('merges bot uploads with attachedFileIds through one resolver call', async () => {
      mockIngestAttachment.mockResolvedValue({
        fileId: 'file-bot',
        isImage: false,
        isVideo: false,
        key: 'files/bot/x/a.pdf',
        resolvedUrl: '',
      });
      mockFindByIds.mockResolvedValue([
        {
          fileType: 'application/pdf',
          id: 'file-web',
          name: 'b.pdf',
          size: 2,
          url: 'b.pdf',
        },
      ]);
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolved,
        fileList: [
          {
            content: 'bot body',
            fileType: 'application/pdf',
            id: 'file-bot',
            name: 'a.pdf',
            size: 1,
            url: 'https://s3.example.com/a.pdf',
          },
          {
            content: 'web body',
            fileType: 'application/pdf',
            id: 'file-web',
            name: 'b.pdf',
            size: 2,
            url: 'https://s3.example.com/b.pdf',
          },
        ],
        orderedFileIds: ['file-bot', 'file-web'],
      });

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-web'],
        files: [{ mimeType: 'application/pdf', name: 'a.pdf', size: 1, url: 'https://cdn/a.pdf' }],
        prompt: 'Both',
      });

      expect(mockResolveAttachmentsByFileIds).toHaveBeenCalledTimes(1);
      expect(mockResolveAttachmentsByFileIds).toHaveBeenCalledWith(
        expect.objectContaining({
          fileIds: ['file-bot', 'file-web'],
          writeMode: 'never',
        }),
      );

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toEqual(['file-bot', 'file-web']);
    });
  });
});
