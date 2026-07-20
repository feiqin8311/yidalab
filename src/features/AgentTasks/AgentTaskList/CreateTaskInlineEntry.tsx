'use client';

import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { $getRoot } from 'lexical';
import { ChevronUp, Paperclip, UserCircle2 } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { message } from '@/components/AntdStaticMethods';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  pickAndInsertAttachments,
} from '@/features/EditorCanvas/editorAttachments';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { useTaskStore } from '@/store/task';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import TaskPriorityTag from '../features/TaskPriorityTag';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import { useAgentVisibility } from '../shared/useAgentVisibility';

interface CreateTaskInlineEntryProps {
  agentId?: string;
  autoFocus?: boolean;
  /**
   * Locks the assignee to `agentId` and hides the agent picker. Used on the
   * agent-scoped task list where every task belongs to that agent.
   */
  lockAssignee?: boolean;
  onCollapse?: () => void;
  onCreated?: (task: { agentId?: string; identifier: string }) => void;
  parentTaskId?: string;
  placeholder?: string;
  /**
   * `hero` adapts the entry for the empty-tasks landing: hides collapse,
   * enlarges the editor area, and forces autoFocus.
   */
  variant?: 'default' | 'hero';
}

const CreateTaskInlineEntry = memo<CreateTaskInlineEntryProps>((props) => {
  const {
    agentId,
    autoFocus,
    lockAssignee,
    onCollapse,
    onCreated,
    parentTaskId,
    placeholder,
    variant = 'default',
  } = props;
  const isHero = variant === 'hero';
  const { t } = useTranslation('chat');
  const { allowed: canCreateTask, reason } = usePermission('create_content');

  const createTask = useTaskStore((s) => s.createTask);
  const isCreating = useTaskStore((s) => s.isCreatingTask);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const activeWorkspaceId = useActiveWorkspaceId();
  const [priority, setPriority] = useState(0);
  const [assigneeAgentId, setAssigneeAgentId] = useState<string | undefined>(agentId);
  const [instruction, setInstruction] = useState('');
  const [hasAttachments, setHasAttachments] = useState(false);

  const editor = useEditor();

  // Persist the in-progress draft per scope so a reload / accidental close
  // doesn't eat a long prompt. Skipped for the transient subtask composer.
  const draftStorageKey = useMemo(
    () => (parentTaskId ? null : `lobehub:task-create-draft:${agentId ?? 'all'}`),
    [agentId, parentTaskId],
  );
  // Tracks which scope key the editor is currently hydrated for. The component
  // is reused across /agent/A/tasks -> /agent/B/tasks -> /tasks without
  // unmounting, so a boolean would strand the new scope on the old draft.
  const draftRestoredKeyRef = useRef<string | null>(null);

  const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);
  // Private agents (incl. personal inbox) cannot run public workspace tasks.
  // Workspace inline create defaults to public; coerce when assignee is private.
  const assigneeVisibility = useAgentVisibility(assigneeAgentId);

  // When the assignee is locked to a scoped agent, keep it in sync with the
  // `agentId` prop. The route subtree is reused across /agent/A/tasks ->
  // /agent/B/tasks and /agent/A/tasks -> /tasks, so without this the hidden
  // assignee would stay on the previous scoped agent.
  useEffect(() => {
    if (lockAssignee) {
      setAssigneeAgentId(agentId);
      return;
    }

    if (!agentId) setAssigneeAgentId(undefined);
  }, [agentId, lockAssignee]);

  useEffect(() => {
    if (!canCreateTask) return;
    if (autoFocus || isHero) editor?.focus?.();
  }, [autoFocus, canCreateTask, editor, isHero]);

  // Hydrate the editor with the current scope's saved draft. Re-runs whenever
  // the scope key changes (not just on mount): it first resets to this scope's
  // baseline so a previous scope's draft can't leak across a switch, then loads
  // the new key's draft. The editor's onContentChange syncs `instruction`.
  useEffect(() => {
    if (!draftStorageKey || !editor) return;
    if (draftRestoredKeyRef.current === draftStorageKey) return;
    draftRestoredKeyRef.current = draftStorageKey;

    // Reset to baseline for the new scope before hydrating.
    editor.cleanDocument?.();
    setPriority(0);
    if (!lockAssignee) setAssigneeAgentId(agentId);

    let raw: string | null;
    try {
      raw = localStorage.getItem(draftStorageKey);
    } catch {
      raw = null;
    }
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as {
        assigneeAgentId?: string;
        markdown?: string;
        priority?: number;
      };
      if (draft.markdown) editor.setDocument?.('markdown', draft.markdown);
      if (typeof draft.priority === 'number') setPriority(draft.priority);
      if (!lockAssignee && draft.assigneeAgentId) setAssigneeAgentId(draft.assigneeAgentId);
    } catch {
      /* ignore a malformed draft */
    }
  }, [agentId, draftStorageKey, editor, lockAssignee]);

  // Back the draft to storage on every change. Gated behind the restore pass so
  // the initial render can't clobber a just-read draft. Write-only on non-empty:
  // the key is cleared only on a successful submit (below), never here — so a
  // `setDocument`-timing gap right after restore can't wipe a valid draft.
  useEffect(() => {
    if (!draftStorageKey || draftRestoredKeyRef.current !== draftStorageKey || !editor) return;
    const markdown = String(editor.getDocument?.('markdown') ?? '').trim();
    if (!markdown) return;
    try {
      localStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          assigneeAgentId: lockAssignee ? undefined : assigneeAgentId,
          markdown,
          priority,
        }),
      );
    } catch {
      /* storage unavailable / quota — persistence is best-effort */
    }
  }, [assigneeAgentId, draftStorageKey, editor, instruction, lockAssignee, priority]);

  const handleCollapse = useCallback(() => {
    if (onCollapse) {
      onCollapse();
      return;
    }
    updateSystemStatus({ taskCreateInlineCollapsed: true }, 'collapseTaskCreateInline');
  }, [onCollapse, updateSystemStatus]);

  const handleContentChange = useCallback(() => {
    if (!canCreateTask) return;
    const lexicalEditor = editor?.getLexicalEditor?.();
    if (!lexicalEditor) return;
    lexicalEditor.getEditorState().read(() => {
      setInstruction($getRoot().getTextContent());
    });
    setHasAttachments(getAttachmentFileIdsFromEditor(editor).length > 0);
  }, [canCreateTask, editor]);

  const handleAttach = useCallback(() => {
    pickAndInsertAttachments(editor);
  }, [editor]);

  const handleSubmit = useCallback(async () => {
    if (!canCreateTask) return;
    const markdown = String(editor?.getDocument?.('markdown') ?? '').trim();
    const trimmedText = instruction.trim();
    const hasFiles = getAttachmentFileIdsFromEditor(editor).length > 0;
    if (!trimmedText && !markdown && !hasFiles) return;

    const firstLine =
      trimmedText
        .split('\n')
        .find((line) => line.trim())
        ?.trim() ?? trimmedText;
    let name: string | undefined;
    if (firstLine) {
      name = firstLine.length > 30 ? `${firstLine.slice(0, 30)}…` : firstLine;
    }

    const editorJson = editor?.getDocument?.('json') as unknown;

    // `createTask` keeps its rejecting contract (other callers rely on `catch`);
    // handle the composer's own failure here so it isn't silent, keeping the
    // draft intact (the reset only runs on success).
    try {
      // Workspace default is shared (public). A private assignee must force a
      // private task — otherwise the server rejects create with a visibility
      // invariant error (personal inbox assistants are usually private).
      const visibility = activeWorkspaceId
        ? assigneeVisibility === 'private'
          ? 'private'
          : 'public'
        : undefined;

      const result = await createTask({
        assigneeAgentId,
        editorData: editorJson,
        instruction: markdown || trimmedText || name || '',
        name,
        parentTaskId,
        priority: priority || undefined,
        visibility,
      });

      if (result) {
        setPriority(0);
        setAssigneeAgentId(agentId);
        setInstruction('');
        editor?.cleanDocument?.();
        if (draftStorageKey) {
          try {
            localStorage.removeItem(draftStorageKey);
          } catch {
            /* ignore */
          }
        }
        onCreated?.({
          agentId: result.assigneeAgentId ?? undefined,
          identifier: result.identifier,
        });
      }
    } catch (error) {
      const raw = (error as { message?: string })?.message ?? '';
      const isPrivateAgentBlock = /public task cannot be assigned to a private agent/i.test(raw);
      message.error(
        isPrivateAgentBlock
          ? t('createTask.visibility.privateAgentLocked')
          : t('createTask.createFailed'),
      );
    }
  }, [
    t,
    activeWorkspaceId,
    agentId,
    assigneeAgentId,
    assigneeVisibility,
    createTask,
    draftStorageKey,
    editor,
    instruction,
    onCreated,
    parentTaskId,
    priority,
    canCreateTask,
  ]);

  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      void handleSubmitRef.current?.();
    }
  }, []);

  return (
    <Block
      style={{ overflow: 'hidden', position: 'relative' }}
      variant={'outlined'}
      onKeyDown={handleKeyDown}
    >
      {!isHero && (
        <ActionIcon
          icon={ChevronUp}
          size={'small'}
          style={{ position: 'absolute', right: 8, top: 8, zIndex: 1 }}
          title={t('createTask.collapse')}
          onClick={handleCollapse}
        />
      )}
      <Flexbox
        style={{
          fontSize: isHero ? 16 : 14,
          // Cap the editor so a long draft scrolls inside the box instead of
          // growing the composer until it pushes the task list below the fold.
          maxHeight: isHero ? 360 : 200,
          overflowY: 'auto',
          padding: isHero ? '20px 24px 4px' : '12px 40px 0 16px',
        }}
      >
        <EditorCanvas
          disabled={!canCreateTask}
          editor={editor}
          floatingToolbar={false}
          placeholder={placeholder ?? t('createTask.instructionPlaceholder')}
          style={{
            fontSize: isHero ? 16 : 14,
            minHeight: isHero ? 80 : undefined,
            paddingBottom: isHero ? 16 : 12,
          }}
          onContentChange={handleContentChange}
        />
      </Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        justify={'space-between'}
        style={{
          borderTop: `1px solid ${cssVar.colorBorderSecondary}`,
          paddingBlock: 8,
          paddingInline: '8px 16px',
        }}
      >
        <Flexbox horizontal gap={2} wrap={'wrap'}>
          <TaskPriorityTag priority={priority} onChange={setPriority}>
            <Block
              clickable
              horizontal
              align="center"
              gap={6}
              paddingBlock={4}
              paddingInline={8}
              variant={'borderless'}
            >
              <TaskPriorityTag disableDropdown priority={priority} size={14} />
              <Text fontSize={12}>
                {priority === 0
                  ? t('taskDetail.priority.none')
                  : t(
                      `taskDetail.priority.${(['', 'urgent', 'high', 'normal', 'low'] as const)[priority]}` as never,
                    )}
              </Text>
            </Block>
          </TaskPriorityTag>

          {(() => {
            const assigneeChip = (
              <Block
                horizontal
                align="center"
                clickable={!lockAssignee}
                gap={6}
                paddingBlock={4}
                paddingInline={8}
                variant={'borderless'}
              >
                {assigneeAgentId ? (
                  <>
                    <AssigneeAvatar agentId={assigneeAgentId} size={18} />
                    <Text fontSize={12}>{assigneeMeta?.title}</Text>
                  </>
                ) : (
                  <>
                    <Icon color={cssVar.colorTextDescription} icon={UserCircle2} size={14} />
                    <Text color={cssVar.colorTextDescription} fontSize={12}>
                      {t('createTask.assignee')}
                    </Text>
                  </>
                )}
              </Block>
            );

            return lockAssignee ? (
              assigneeChip
            ) : (
              <AssigneeAgentSelector currentAgentId={assigneeAgentId} onChange={setAssigneeAgentId}>
                {assigneeChip}
              </AssigneeAgentSelector>
            );
          })()}

          <ActionIcon
            icon={Paperclip}
            size={'small'}
            title={t('upload.action.tooltip')}
            onClick={handleAttach}
          />
        </Flexbox>

        <Button
          disabled={!canCreateTask || isCreating || (!instruction.trim() && !hasAttachments)}
          loading={isCreating}
          shape={'round'}
          size={'small'}
          title={canCreateTask ? undefined : reason}
          type={'primary'}
          onClick={handleSubmit}
        >
          {t('createTask.submit')}
        </Button>
      </Flexbox>
    </Block>
  );
});

export default CreateTaskInlineEntry;
