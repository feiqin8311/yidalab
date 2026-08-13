'use client';

import { Center } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  audio: css`
    width: min(520px, 100%);
  `,
  container: css`
    padding: ${cssVar.paddingSM};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
}));

interface AudioViewerProps {
  fileId: string;
  url: string | null;
}

const AudioViewer = memo<AudioViewerProps>(({ url }) => {
  if (!url) return null;

  return (
    <Center className={styles.container} height={'100%'} width={'100%'}>
      <audio controls className={styles.audio} preload={'metadata'} src={url} />
    </Center>
  );
});

AudioViewer.displayName = 'AudioViewer';

export default AudioViewer;
