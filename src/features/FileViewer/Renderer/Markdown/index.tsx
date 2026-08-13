'use client';

import { Center, Flexbox, Markdown, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { useTextFileLoader } from '../../hooks/useTextFileLoader';

const styles = createStaticStyles(({ css, cssVar }) => ({
  empty: css`
    color: ${cssVar.colorTextDescription};
  `,
  page: css`
    overflow: auto;
    width: 100%;
    height: 100%;
    padding: ${cssVar.paddingLG};
  `,
}));

interface MarkdownViewerProps {
  fileId: string;
  url: string | null;
}

const MarkdownViewer = memo<MarkdownViewerProps>(({ url }) => {
  const { t } = useTranslation('file');
  const { error, fileData, loading } = useTextFileLoader(url);

  if (loading) {
    return (
      <Center height={'100%'}>
        <NeuralNetworkLoading size={36} />
      </Center>
    );
  }

  if (error || !fileData) {
    return (
      <Center height={'100%'}>
        <Text className={styles.empty}>{t('preview.loadError')}</Text>
      </Center>
    );
  }

  return (
    <Flexbox className={styles.page} id="markdown-renderer">
      <Markdown variant={'chat'}>{fileData}</Markdown>
    </Flexbox>
  );
});

export default MarkdownViewer;
