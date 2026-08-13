'use client';

import { Center, Flexbox, Text } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TableVirtuoso } from 'react-virtuoso';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { useSpreadsheetLoader } from '../../hooks/useSpreadsheetLoader';

const styles = createStaticStyles(({ css, cssVar }) => ({
  empty: css`
    color: ${cssVar.colorTextDescription};
  `,
  page: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 100%;
    min-width: 0;
    height: 100%;
    min-height: 0;
  `,
  td: css`
    padding-block: 6px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    white-space: nowrap;
  `,
  th: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    padding-block: 6px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};

    font-weight: 600;
    color: ${cssVar.colorText};
    text-align: start;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  viewport: css`
    overflow: auto;
    flex: 1;

    width: 100%;
    min-width: 0;
    min-height: 0;

    table {
      border-collapse: collapse;

      width: max-content;
      min-width: 100%;

      font-family: ${cssVar.fontFamilyCode};
      font-size: 12px;
      line-height: 1.4;
    }
  `,
}));

interface SpreadsheetViewerProps {
  fileId: string;
  url: string | null;
}

const SpreadsheetViewer = memo<SpreadsheetViewerProps>(({ url }) => {
  const { t } = useTranslation('file');
  const { error, loading, sheets } = useSpreadsheetLoader(url);
  const [activeSheet, setActiveSheet] = useState(0);

  useEffect(() => {
    setActiveSheet(0);
  }, [url]);

  if (!url) return null;

  if (loading) {
    return (
      <Center height={'100%'}>
        <NeuralNetworkLoading size={36} />
      </Center>
    );
  }

  if (error || sheets.length === 0) {
    return (
      <Center height={'100%'}>
        <Text className={styles.empty}>{t('preview.spreadsheet.loadError')}</Text>
      </Center>
    );
  }

  const safeIndex = Math.min(activeSheet, sheets.length - 1);
  const sheet = sheets[safeIndex];
  const isEmpty = sheet.headers.every((cell) => !cell) && sheet.rows.length === 0;

  return (
    <Flexbox className={styles.page} gap={8}>
      {sheets.length > 1 && (
        <Tabs
          activeKey={String(safeIndex)}
          items={sheets.map((item, index) => ({
            key: String(index),
            label: item.name,
          }))}
          onChange={(key) => setActiveSheet(Number(key))}
        />
      )}

      {isEmpty ? (
        <Center flex={1}>
          <Text className={styles.empty}>{t('preview.spreadsheet.empty')}</Text>
        </Center>
      ) : (
        <TableVirtuoso
          className={styles.viewport}
          data={sheet.rows}
          defaultItemHeight={31}
          increaseViewportBy={200}
          key={safeIndex}
          fixedHeaderContent={() =>
            sheet.headers.length > 0 ? (
              <tr>
                {sheet.headers.map((cell, index) => (
                  <th className={styles.th} key={index} title={cell}>
                    {cell || '\u00A0'}
                  </th>
                ))}
              </tr>
            ) : null
          }
          itemContent={(_, row) =>
            row.map((cell, cellIndex) => (
              <td className={styles.td} key={cellIndex} title={cell}>
                {cell || '\u00A0'}
              </td>
            ))
          }
        />
      )}

      {!isEmpty && (
        <Text className={styles.empty} fontSize={12}>
          {t('preview.spreadsheet.summary', {
            totalCols: sheet.totalCols,
            totalRows: sheet.totalRows,
          })}
        </Text>
      )}
    </Flexbox>
  );
});

SpreadsheetViewer.displayName = 'SpreadsheetViewer';

export default SpreadsheetViewer;
