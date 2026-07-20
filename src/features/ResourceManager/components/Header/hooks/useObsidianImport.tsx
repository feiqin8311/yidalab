import { Flexbox, Icon } from '@lobehub/ui';
import debug from 'debug';
import { type TFunction } from 'i18next';
import { BookMarked } from 'lucide-react';
import { type ChangeEvent, useCallback, useRef } from 'react';

import { createGuideModal } from '@/components/GuideModal';
import { type DocumentAction } from '@/store/file/slices/document/action';
import { unzipFile } from '@/utils/unzipFile';

import { parseObsidianMarkdownNote, shouldSkipObsidianPath } from './obsidianMarkdown';

const log = debug('resource:obsidian-import');

interface UseObsidianImportOptions {
  createDocument: DocumentAction['createDocument'];
  currentFolderId?: string | null;
  libraryId?: string | null;
  refetchResources?: () => Promise<void>;
  t: TFunction<'file'>;
}

const useObsidianImport = ({
  createDocument,
  currentFolderId,
  libraryId,
  refetchResources,
  t,
}: UseObsidianImportOptions) => {
  const obsidianInputRef = useRef<HTMLInputElement>(null);

  const handleOpenObsidianGuide = useCallback(() => {
    createGuideModal({
      cancelText: t('header.actions.obsidianGuide.cancel'),
      cover: (
        <Flexbox
          align="center"
          justify="center"
          style={{ background: 'var(--lobe-color-fill-secondary, #f5f5f5)', height: 160 }}
        >
          <Icon icon={BookMarked} size={48} />
        </Flexbox>
      ),
      desc: t('header.actions.obsidianGuide.desc'),
      okText: t('header.actions.obsidianGuide.ok'),
      onOk: () => {
        obsidianInputRef.current?.click();
      },
      title: t('header.actions.obsidianGuide.title'),
    });
  }, [t]);

  const handleObsidianImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const { message } = await import('antd');

        const loadingKey = 'obsidian-import';
        message.loading({
          content: t('header.actions.obsidian.importing'),
          duration: 0,
          key: loadingKey,
        });

        let files = await unzipFile(file);

        const nestedZips = files.filter((f) => f.name.toLowerCase().endsWith('.zip'));
        if (nestedZips.length > 0) {
          const allNestedFiles: File[] = [];
          for (const zipFile of nestedZips) {
            try {
              allNestedFiles.push(...(await unzipFile(zipFile)));
            } catch (error) {
              console.error(`Failed to extract nested ZIP ${zipFile.name}:`, error);
            }
          }
          files = allNestedFiles;
        }

        const mdFiles = files.filter((f) => {
          const name = f.name.toLowerCase();
          if (!name.endsWith('.md') && !name.endsWith('.markdown')) return false;
          return !shouldSkipObsidianPath(f.name);
        });

        log(
          'Obsidian md files:',
          mdFiles.map((f) => f.name),
        );

        if (mdFiles.length === 0) {
          message.destroy(loadingKey);
          message.warning(
            t('header.actions.obsidian.noMarkdownFiles') +
              ` (${t('header.actions.obsidian.foundFiles', { count: files.length })})`,
          );
          return;
        }

        let successCount = 0;
        let failedCount = 0;

        for (const mdFile of mdFiles) {
          try {
            const raw = await mdFile.text();
            const { content, title } = parseObsidianMarkdownNote(raw, mdFile.name);

            await createDocument({
              content,
              knowledgeBaseId: libraryId ?? undefined,
              parentId: currentFolderId ?? undefined,
              title,
            });

            successCount++;
          } catch (error) {
            console.error(`Failed to import ${mdFile.name}:`, error);
            failedCount++;
          }
        }

        message.destroy(loadingKey);

        if (failedCount === 0) {
          message.success(t('header.actions.obsidian.success', { count: successCount }));
        } else {
          message.warning(
            t('header.actions.obsidian.partial', {
              failed: failedCount,
              success: successCount,
            }),
          );
        }

        await refetchResources?.();
      } catch (error) {
        console.error('Failed to import Obsidian vault:', error);
        const { message } = await import('antd');
        message.error(t('header.actions.obsidian.error'));
      }

      event.target.value = '';
    },
    [createDocument, currentFolderId, libraryId, refetchResources, t],
  );

  return {
    handleObsidianImport,
    handleOpenObsidianGuide,
    obsidianInputRef,
  };
};

export default useObsidianImport;
