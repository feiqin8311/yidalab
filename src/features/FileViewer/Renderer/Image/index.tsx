'use client';

import { Center, Text } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

interface ImageViewerProps {
  fileId: string;
  url: string | null;
}

const ImageViewer = memo<ImageViewerProps>(({ url }) => {
  const { t } = useTranslation('file');
  const [isLoaded, setIsLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!url) return null;

  if (failed) {
    return (
      <Center height={'100%'}>
        <Text type={'secondary'}>{t('preview.loadError')}</Text>
      </Center>
    );
  }

  return (
    <Center height={'100%'} width={'100%'}>
      {!isLoaded && <NeuralNetworkLoading size={36} />}
      <img
        alt="Image preview"
        src={url}
        style={{
          display: isLoaded ? 'block' : 'none',
          height: '100%',
          objectFit: 'contain',
          overflow: 'hidden',
          width: '100%',
        }}
        onError={() => setFailed(true)}
        onLoad={() => setIsLoaded(true)}
      />
    </Center>
  );
});

export default ImageViewer;
