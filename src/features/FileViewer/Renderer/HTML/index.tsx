'use client';

import { Center, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { InlineHtmlPreview } from '@/components/HtmlPreview';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { useTextFileLoader } from '../../hooks/useTextFileLoader';

const styles = createStaticStyles(({ css }) => ({
  page: css`
    width: 100%;
    height: 100%;
    padding: 0;
  `,
}));

interface HTMLViewerProps {
  fileId: string;
  url: string | null;
}

const HTMLViewer = memo<HTMLViewerProps>(({ url }) => {
  const { t } = useTranslation('file');
  const { error, fileData, loading } = useTextFileLoader(url);

  if (loading) {
    return (
      <Center height={'100%'}>
        <NeuralNetworkLoading size={36} />
      </Center>
    );
  }

  if (error || fileData === null) {
    return (
      <Center height={'100%'}>
        <Text type={'secondary'}>{t('preview.loadError')}</Text>
      </Center>
    );
  }

  return (
    <Flexbox className={styles.page}>
      <InlineHtmlPreview content={fileData} />
    </Flexbox>
  );
});

HTMLViewer.displayName = 'HTMLViewer';

export default HTMLViewer;
