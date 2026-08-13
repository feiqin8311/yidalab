import { AGENT_DOCUMENT_CATEGORY } from '@lobechat/const';
import { type ItemType } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { FileTextIcon, LibraryBig, RefreshCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import DotsLoading from '@/components/DotsLoading';
import FileIcon from '@/components/FileIcon';
import RepoIcon from '@/components/LibIcon';
import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import CheckboxItem from '../components/CheckboxWithLoading';

// Cap so the widest library/file row (icon + label + checkbox + paddings) stays within the
// submenu's 320px footer-driven width, keeping it level with the skill submenu instead of
// growing past it.
const labelMaxWidth = 'min(210px, 45vw)';

const styles = createStaticStyles(({ css }) => ({
  viewMore: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    /* width 320 + margin-inline -12 anchors the submenu to 320px (matching the skill
       submenu) and lets the row span full width; padding-inline 12 lines its icon/text
       up with the menu items above. */
    width: 320px;
    min-height: 32px;

    /* The footer wrapper adds padding-block: 8px top & bottom; the top keeps it separated
       from the list, but the bottom leaves a dead gap against the popup edge — cancel it. */
    margin-block-end: -8px;
    margin-inline: -12px;
    padding-inline: 12px;
    border: 0;
    border-radius: 6px;

    font-size: 14px;
    color: ${cssVar.colorText};

    background: transparent;

    transition: background 150ms ${cssVar.motionEaseOut};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  viewMoreLabel: css`
    flex: 1;
    text-align: start;
  `,
}));

export interface KnowledgeControls {
  enabledCount: number;
  footer: ReactNode;
  items: ItemType[];
}

export const useControls = ({
  openAttachKnowledgeModal,
}: {
  openAttachKnowledgeModal: () => void;
}) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();

  const files = useAgentStore((s) => agentByIdSelectors.getAgentFilesById(agentId)(s), isEqual);
  const knowledgeBases = useAgentStore(
    (s) => agentByIdSelectors.getAgentKnowledgeBasesById(agentId)(s),
    isEqual,
  );
  const enabledAgentDocumentIds = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s).enabledAgentDocumentIds ?? [],
    isEqual,
  );
  const enabledAgentDocumentIdSet = new Set(enabledAgentDocumentIds);
  const {
    data: agentDocuments = [],
    error: agentDocumentsError,
    isLoading: isLoadingAgentDocuments,
    mutate: mutateAgentDocuments,
  } = useClientDataSWR(agentId ? agentDocumentSWRKeys.documentsList(agentId) : null, () =>
    agentDocumentService.listDocuments({ agentId }),
  );
  const selectableAgentDocuments = agentDocuments.filter(
    (document) => document.category === AGENT_DOCUMENT_CATEGORY && !document.isFolder,
  );

  const [toggleFile, toggleKnowledgeBase, updateAgentChatConfigById] = useAgentStore((s) => [
    s.toggleFile,
    s.toggleKnowledgeBase,
    s.updateAgentChatConfigById,
  ]);
  const enabledCount =
    files.filter((item) => item.enabled).length +
    knowledgeBases.filter((item) => item.enabled).length +
    selectableAgentDocuments.filter((document) => enabledAgentDocumentIdSet.has(document.id))
      .length;

  const libraryItems = knowledgeBases.map((item) => ({
    icon: <RepoIcon />,
    key: item.id,
    label: (
      <CheckboxItem
        checked={item.enabled}
        hasPadding={false}
        id={item.id}
        label={item.name}
        labelMaxWidth={labelMaxWidth}
        onUpdate={async (id, enabled) => {
          await toggleKnowledgeBase(id, enabled);
        }}
      />
    ),
  }));

  const fileItems = files.map((item) => ({
    icon: <FileIcon fileName={item.name} fileType={item.type} size={20} />,
    key: item.id,
    label: (
      <CheckboxItem
        checked={item.enabled}
        hasPadding={false}
        id={item.id}
        label={item.name}
        labelMaxWidth={labelMaxWidth}
        onUpdate={async (id, enabled) => {
          await toggleFile(id, enabled);
        }}
      />
    ),
  }));

  const documentItems: ItemType[] = selectableAgentDocuments.map((document) => ({
    icon: <FileTextIcon size={20} />,
    key: document.id,
    label: (
      <CheckboxItem
        checked={enabledAgentDocumentIdSet.has(document.id)}
        hasPadding={false}
        id={document.id}
        label={document.title || document.filename}
        labelMaxWidth={labelMaxWidth}
        onUpdate={async (id, enabled) => {
          const nextIds = enabled
            ? [...new Set([...enabledAgentDocumentIds, id])]
            : enabledAgentDocumentIds.filter((documentId) => documentId !== id);
          await updateAgentChatConfigById(agentId, { enabledAgentDocumentIds: nextIds });
        }}
      />
    ),
  }));

  const documentStateItems: ItemType[] = isLoadingAgentDocuments
    ? [
        {
          disabled: true,
          key: 'agent-documents-loading',
          label: <DotsLoading />,
        },
      ]
    : agentDocumentsError
      ? [
          {
            icon: <RefreshCwIcon size={16} />,
            key: 'agent-documents-error',
            label: (
              <Button
                size={'small'}
                type={'text'}
                onClick={(event) => {
                  event.stopPropagation();
                  void mutateAgentDocuments();
                }}
              >
                {t('knowledgeBase.documentsLoadError')}
              </Button>
            ),
          },
        ]
      : documentItems;

  // Flat list (no "Libraries" / "Files" group headers): libraries first, then files.
  const relatedGroups: ItemType[] = [
    ...libraryItems,
    ...(libraryItems.length > 0 && fileItems.length > 0 ? [{ type: 'divider' as const }] : []),
    ...fileItems,
    ...((libraryItems.length > 0 || fileItems.length > 0) && documentStateItems.length > 0
      ? [{ type: 'divider' as const }]
      : []),
    ...documentStateItems,
  ];

  const footer = (
    <button
      className={cx(styles.viewMore)}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        openAttachKnowledgeModal();
      }}
    >
      <Icon icon={LibraryBig} size={16} />
      <span className={cx(styles.viewMoreLabel)}>{t('knowledgeBase.viewMore')}</span>
    </button>
  );

  return { enabledCount, footer, items: relatedGroups } satisfies KnowledgeControls;
};
