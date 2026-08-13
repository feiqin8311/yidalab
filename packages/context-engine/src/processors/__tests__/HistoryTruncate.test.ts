import { describe, expect, it } from 'vitest';

import { getSlicedMessages, HistoryTruncateProcessor } from '../HistoryTruncate';

describe('HistoryTruncateProcessor', () => {
  describe('getSlicedMessages', () => {
    const messages = [
      { id: '1', content: 'First', role: 'user' },
      { id: '2', content: 'Second', role: 'assistant' },
      { id: '3', content: 'Third', role: 'user' },
      { id: '4', content: 'Fourth', role: 'assistant' },
      { id: '5', content: 'Fifth', role: 'user' },
    ];

    it('should return all messages when history count is disabled', () => {
      const result = getSlicedMessages(messages, { enableHistoryCount: false });
      expect(result).toEqual(messages);
    });

    it('should return all messages when historyCount is undefined', () => {
      const result = getSlicedMessages(messages, {
        enableHistoryCount: true,
        historyCount: undefined,
      });
      expect(result).toEqual(messages);
    });

    it('should return last N messages based on historyCount', () => {
      const result = getSlicedMessages(messages, {
        enableHistoryCount: true,
        historyCount: 2,
      });
      expect(result).toEqual([
        { id: '4', content: 'Fourth', role: 'assistant' },
        { id: '5', content: 'Fifth', role: 'user' },
      ]);
    });

    it('should include new user message in count when includeNewUserMessage is true', () => {
      const result = getSlicedMessages(messages, {
        enableHistoryCount: true,
        historyCount: 3,
      });

      expect(result).toEqual([
        { id: '3', content: 'Third', role: 'user' },
        { id: '4', content: 'Fourth', role: 'assistant' },
        { id: '5', content: 'Fifth', role: 'user' },
      ]);
    });

    it('should keep trailing user message when historyCount is 0', () => {
      const result = getSlicedMessages(messages, {
        enableHistoryCount: true,
        historyCount: 0,
      });
      // Current user turn (trailing user) is protected even at historyCount 0
      expect(result).toEqual([{ id: '5', content: 'Fifth', role: 'user' }]);
    });

    it('should keep compressedGroup + trailing user when historyCount is 0', () => {
      const withCheckpoint = [
        { id: 'cg1', content: 'summary', role: 'compressedGroup' },
        { id: 'u1', content: 'follow up', role: 'user' },
      ];
      const result = getSlicedMessages(withCheckpoint, {
        enableHistoryCount: true,
        historyCount: 0,
      });
      expect(result.map((m) => m.id)).toEqual(['cg1', 'u1']);
    });

    it('should keep compressedGroup when historyCount is 0 and trailing is assistant', () => {
      const withCheckpoint = [
        { id: 'cg1', content: 'summary', role: 'compressedGroup' },
        { id: 'a1', content: 'reply', role: 'assistant' },
      ];
      const result = getSlicedMessages(withCheckpoint, {
        enableHistoryCount: true,
        historyCount: 0,
      });
      expect(result.map((m) => m.id)).toEqual(['cg1']);
    });

    it('should keep protected anchors when historyCount is negative', () => {
      const result = getSlicedMessages(messages, {
        enableHistoryCount: true,
        historyCount: -1,
      });
      expect(result).toEqual([{ id: '5', content: 'Fifth', role: 'user' }]);
    });

    it('should return all messages when historyCount exceeds array length', () => {
      const result = getSlicedMessages(messages, {
        enableHistoryCount: true,
        historyCount: 10,
      });
      expect(result).toEqual(messages);
    });

    it('should handle empty message array', () => {
      const result = getSlicedMessages([], {
        enableHistoryCount: true,
        historyCount: 2,
      });
      expect(result).toEqual([]);
    });

    describe('Group-aware truncation', () => {
      it('should count AssistantGroup as a single unit', () => {
        // Simulate: user -> assistant with tools -> tool -> assistant (same agentId)
        const messagesWithGroup = [
          { id: '1', content: 'User message 1', role: 'user' },
          { id: '2', content: 'User message 2', role: 'user' },
          {
            agentId: 'agent-1',
            content: 'First assistant',
            id: '3',
            parentId: '2',
            role: 'assistant',
            tools: [{ id: '4' }],
          },
          { id: '4', content: 'Tool result', parentId: '3', role: 'tool', tool_call_id: 'call-1' },
          {
            agentId: 'agent-1',
            content: 'Second assistant',
            id: '5',
            parentId: '4',
            role: 'assistant',
          },
        ];

        // Groups identified:
        // - Group 0: user message 1 (id: 1)
        // - Group 1: user message 2 (id: 2)
        // - Group 2: AssistantGroup (ids: 3, 4, 5)
        // historyCount: 2 should keep last 2 groups: Group 1 and Group 2
        const result = getSlicedMessages(messagesWithGroup, {
          enableHistoryCount: true,
          historyCount: 2,
        });

        expect(result).toHaveLength(4);
        expect(result.map((m: any) => m.id)).toEqual(['2', '3', '4', '5']);
      });

      it('should stop AssistantGroup chain when agentId changes', () => {
        const messagesWithGroup = [
          { id: '1', content: 'User message', role: 'user' },
          {
            agentId: 'agent-1',
            content: 'First assistant',
            id: '2',
            parentId: '1',
            role: 'assistant',
            tools: [{ id: '3' }],
          },
          { id: '3', content: 'Tool result', parentId: '2', role: 'tool', tool_call_id: 'call-1' },
          {
            agentId: 'agent-2', // Different agent!
            content: 'Second assistant',
            id: '4',
            parentId: '3',
            role: 'assistant',
          },
        ];

        // historyCount: 1 should only keep the last "group"
        // Since agent-2 is different, it's a separate single message
        const result = getSlicedMessages(messagesWithGroup, {
          enableHistoryCount: true,
          historyCount: 1,
        });

        // Should keep only the last message (different agentId breaks the group)
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('4');
      });

      it('should count AgentCouncil as a single unit', () => {
        const messagesWithCouncil = [
          { id: '1', content: 'User message', role: 'user' },
          {
            id: '2',
            content: 'Tool message',
            metadata: { agentCouncil: true },
            parentId: '1',
            role: 'tool',
          },
          {
            agentId: 'agent-1',
            content: 'Agent 1 response',
            id: '3',
            parentId: '2',
            role: 'assistant',
          },
          {
            agentId: 'agent-2',
            content: 'Agent 2 response',
            id: '4',
            parentId: '2',
            role: 'assistant',
          },
        ];

        // historyCount: 1 should keep the entire council (tool + all children)
        const result = getSlicedMessages(messagesWithCouncil, {
          enableHistoryCount: true,
          historyCount: 1,
        });

        expect(result).toHaveLength(3);
        expect(result.map((m: any) => m.id)).toEqual(['2', '3', '4']);
      });

      it('should count Tasks group as a single unit', () => {
        const messagesWithTasks = [
          { id: '1', content: 'User message', role: 'user' },
          { id: '2', content: 'Tool message', parentId: '1', role: 'tool' },
          { content: 'Task 1', id: '3', parentId: '2', role: 'task' },
          { content: 'Task 2', id: '4', parentId: '2', role: 'task' },
          { content: 'Task 3', id: '5', parentId: '2', role: 'task' },
        ];

        // historyCount: 1 should keep the entire task group (tool + all tasks)
        const result = getSlicedMessages(messagesWithTasks, {
          enableHistoryCount: true,
          historyCount: 1,
        });

        expect(result).toHaveLength(4);
        expect(result.map((m: any) => m.id)).toEqual(['2', '3', '4', '5']);
      });

      it('should count Compare group as a single unit', () => {
        const messagesWithCompare = [
          { id: '1', content: 'User message', role: 'user' },
          {
            content: 'Compare message',
            id: '2',
            metadata: { compare: true },
            parentId: '1',
            role: 'user',
          },
          { content: 'Column 1', id: '3', parentId: '2', role: 'assistant' },
          { content: 'Column 2', id: '4', parentId: '2', role: 'assistant' },
        ];

        // historyCount: 1 should keep the entire compare group
        const result = getSlicedMessages(messagesWithCompare, {
          enableHistoryCount: true,
          historyCount: 1,
        });

        expect(result).toHaveLength(3);
        expect(result.map((m: any) => m.id)).toEqual(['2', '3', '4']);
      });

      it('keeps a multi-step same-user-turn chain when tool row id ≠ call id', () => {
        // UI tool rows have their own id; tools[].id / tool_call_id is the call id.
        // Next assistant parents to the tool *message* id.
        const messages = [
          { id: 'u1', content: 'one question', role: 'user' },
          {
            agentId: 'agent-1',
            content: 'first call',
            id: 'a1',
            parentId: 'u1',
            role: 'assistant',
            tools: [{ id: 'call_1' }],
          },
          {
            id: 'tm1',
            content: 'tool 1',
            parentId: 'a1',
            role: 'tool',
            tool_call_id: 'call_1',
          },
          {
            agentId: 'agent-1',
            content: 'second call',
            id: 'a2',
            parentId: 'tm1',
            role: 'assistant',
            tools: [{ id: 'call_2' }],
          },
          {
            id: 'tm2',
            content: 'tool 2',
            parentId: 'a2',
            role: 'tool',
            tool_call_id: 'call_2',
          },
        ];

        const byCount = getSlicedMessages(messages, {
          enableHistoryCount: true,
          historyCount: 1,
        });
        expect(byCount.map((m: any) => m.id)).toEqual(['a1', 'tm1', 'a2', 'tm2']);

        const byTokens = getSlicedMessages(messages, { maxHistoryTokens: 20 });
        expect(byTokens.map((m: any) => m.id)).toEqual(
          expect.arrayContaining(['a1', 'tm1', 'a2', 'tm2']),
        );
        // Broken childrenMap.get(callId) dropped a1/tm1 and left only a2,tm2.
        expect(byTokens.map((m: any) => m.id)).not.toEqual(['a2', 'tm2']);
      });

      it('token budget keeps continuous tail, no holes', () => {
        // u1 a1 (small) u2 a2 (huge) u3 (small) — must not drop a2 and keep u1
        const huge = 'x'.repeat(40_000);
        const messages = [
          { id: 'u1', content: 'old user', role: 'user' },
          { id: 'a1', content: 'old asst', role: 'assistant', parentId: 'u1' },
          { id: 'u2', content: 'mid user', role: 'user' },
          { id: 'a2', content: huge, role: 'assistant', parentId: 'u2' },
          { id: 'u3', content: 'new user', role: 'user' },
        ];
        // Budget fits ~u3 + partial a2 only if we skip a2 — continuous rule keeps
        // from tail: u3 first, then a2 (even if over budget alone as first), stop
        // before older groups once over budget after first non-fit attempt.
        const result = getSlicedMessages(messages, {
          maxHistoryTokens: 500,
        });
        const ids = result.map((m: any) => m.id);
        // Continuous from tail: must include u3; if a2 kept, u1/a1 must not appear alone without a2/u2
        expect(ids).toContain('u3');
        // No hole: if u1 kept, everything after u1 must also be kept
        if (ids.includes('u1')) {
          expect(ids).toEqual(['u1', 'a1', 'u2', 'a2', 'u3']);
        } else if (ids.includes('u2')) {
          expect(ids).toEqual(expect.arrayContaining(['u2', 'a2', 'u3']));
          expect(ids).not.toContain('u1');
        } else {
          // only tail
          expect(ids.every((id: string) => ['a2', 'u3'].includes(id))).toBe(true);
        }
      });

      it('should handle mixed groups correctly', () => {
        const mixedMessages = [
          { id: '1', content: 'User 1', role: 'user' },
          { content: 'Assistant 1', id: '2', parentId: '1', role: 'assistant' },
          { id: '3', content: 'User 2', role: 'user' },
          {
            agentId: 'agent-1',
            content: 'Assistant with tools',
            id: '4',
            parentId: '3',
            role: 'assistant',
            tools: [{ id: '5' }],
          },
          { id: '5', parentId: '4', role: 'tool' },
          {
            agentId: 'agent-1',
            content: 'Final assistant',
            id: '6',
            parentId: '5',
            role: 'assistant',
          },
          { id: '7', content: 'User 3', role: 'user' },
        ];

        // historyCount: 2 should keep:
        // - Group 1: AssistantGroup (ids 4, 5, 6)
        // - Group 2: User 3 (id 7)
        const result = getSlicedMessages(mixedMessages, {
          enableHistoryCount: true,
          historyCount: 2,
        });

        expect(result).toHaveLength(4);
        expect(result.map((m: any) => m.id)).toEqual(['4', '5', '6', '7']);
      });
    });
  });

  describe('HistoryTruncateProcessor', () => {
    it('should truncate messages based on configuration', async () => {
      const processor = new HistoryTruncateProcessor({
        enableHistoryCount: true,
        historyCount: 3,
      });

      const context = {
        initialState: {
          messages: [],
          model: 'gpt-4',
          provider: 'openai',
          systemRole: '',
          tools: [],
        },
        messages: [
          { id: '1', content: 'First', role: 'user', createdAt: Date.now(), updatedAt: Date.now() },
          {
            id: '2',
            content: 'Second',
            role: 'assistant',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          { id: '3', content: 'Third', role: 'user', createdAt: Date.now(), updatedAt: Date.now() },
          {
            id: '4',
            content: 'Fourth',
            role: 'assistant',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          { id: '5', content: 'Fifth', role: 'user', createdAt: Date.now(), updatedAt: Date.now() },
        ],
        metadata: {
          model: 'gpt-4',
          maxTokens: 4096,
        },
        isAborted: false,
      };

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(3); // 2 + 1 for new user message
      expect(result.messages).toEqual([
        expect.objectContaining({ content: 'Third' }),
        expect.objectContaining({ content: 'Fourth' }),
        expect.objectContaining({ content: 'Fifth' }),
      ]);
      expect(result.metadata.historyTruncated).toBe(2);
      expect(result.metadata.finalMessageCount).toBe(3);
    });

    it('should not truncate when history count is disabled', async () => {
      const processor = new HistoryTruncateProcessor({
        enableHistoryCount: false,
      });

      const context = {
        initialState: {
          messages: [],
          model: 'gpt-4',
          provider: 'openai',
          systemRole: '',
          tools: [],
        },
        messages: [
          { id: '1', content: 'First', role: 'user', createdAt: Date.now(), updatedAt: Date.now() },
          {
            id: '2',
            content: 'Second',
            role: 'assistant',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        metadata: {
          model: 'gpt-4',
          maxTokens: 4096,
        },
        isAborted: false,
      };

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.metadata.historyTruncated).toBe(0);
      expect(result.metadata.finalMessageCount).toBe(2);
    });
  });
});
