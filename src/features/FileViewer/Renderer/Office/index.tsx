'use client';

import { Center, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { type OfficePreviewKind, useOfficePreview } from '../../hooks/useOfficePreview';

const styles = createStaticStyles(({ css, cssVar }) => ({
  article: css`
    overflow-x: auto;

    max-width: 880px;
    margin-inline: auto;
    padding: 24px;

    font-size: 14px;
    line-height: 1.7;
    color: ${cssVar.colorText};

    h1,
    h2,
    h3,
    h4 {
      margin-block: 1em 0.4em;
      font-weight: 600;
    }

    p {
      margin-block: 0.6em;
    }

    table {
      border-collapse: collapse;
      width: max-content;
      min-width: 100%;
      margin-block: 12px;
    }

    td,
    th {
      padding-block: 6px;
      padding-inline: 10px;
      border: 1px solid ${cssVar.colorBorderSecondary};
    }

    img {
      max-width: 100%;
      height: auto;
    }
  `,
  empty: css`
    color: ${cssVar.colorTextDescription};
  `,
  page: css`
    overflow: auto;
    width: 100%;
    height: 100%;
  `,
  slide: css`
    padding-block: 16px;
    padding-inline: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  slides: css`
    max-width: 880px;
    margin-inline: auto;
    padding-block: 16px 32px;
    padding-inline: 24px;
  `,
}));

interface OfficeViewerProps {
  fileId: string;
  kind: OfficePreviewKind;
  url: string | null;
}

const OfficeViewer = memo<OfficeViewerProps>(({ kind, url }) => {
  const { t } = useTranslation('file');
  const { error, html, loading, slides } = useOfficePreview(url, kind);

  if (!url) return null;

  if (loading) {
    return (
      <Center height={'100%'}>
        <NeuralNetworkLoading size={36} />
      </Center>
    );
  }

  if (error) {
    return (
      <Center height={'100%'}>
        <Text className={styles.empty}>{t('preview.office.loadError')}</Text>
      </Center>
    );
  }

  if (kind === 'pptx') {
    const readable = slides.filter((slide) => slide.text);
    if (readable.length === 0) {
      return (
        <Center height={'100%'}>
          <Text className={styles.empty}>{t('preview.office.empty')}</Text>
        </Center>
      );
    }

    return (
      <div className={styles.page}>
        <Flexbox className={styles.slides} gap={12}>
          {slides.map((slide) => (
            <Flexbox className={styles.slide} gap={8} key={slide.number}>
              <Text type={'secondary'}>{t('preview.office.slide', { number: slide.number })}</Text>
              <Text style={{ whiteSpace: 'pre-wrap' }}>{slide.text || '—'}</Text>
            </Flexbox>
          ))}
        </Flexbox>
      </div>
    );
  }

  if (!html.trim()) {
    return (
      <Center height={'100%'}>
        <Text className={styles.empty}>{t('preview.office.empty')}</Text>
      </Center>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.article} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
});

OfficeViewer.displayName = 'OfficeViewer';

export default OfficeViewer;
