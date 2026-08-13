'use client';

import { Center, Flexbox, Highlighter, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { getLanguageFromFilename } from '@/utils/fileLanguage';

import { useTextFileLoader } from '../../hooks/useTextFileLoader';

const styles = createStaticStyles(({ css }) => ({
  page: css`
    overflow: auto;

    width: 100%;
    min-width: 0;
    height: 100%;
    padding-inline: 24px 4px;
  `,
}));

interface CodeViewerProps {
  fileId: string;
  fileName?: string;
  url: string | null;
}

const CodeViewer = memo<CodeViewerProps>(({ url, fileName }) => {
  const { t } = useTranslation('file');
  const { error, fileData, loading } = useTextFileLoader(url);
  const language = getLanguageFromFilename(fileName);

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
        <Text type={'secondary'}>{t('preview.loadError')}</Text>
      </Center>
    );
  }

  return (
    <Flexbox className={styles.page}>
      <Highlighter language={language} showLanguage={false} variant={'borderless'}>
        {fileData}
      </Highlighter>
    </Flexbox>
  );
});

export default CodeViewer;
