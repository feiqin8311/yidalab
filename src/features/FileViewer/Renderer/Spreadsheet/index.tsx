'use client';

import { Center, Flexbox, Text } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { useSpreadsheetLoader } from '../../hooks/useSpreadsheetLoader';
import { SPREADSHEET_PREVIEW_MAX_COLS, SPREADSHEET_PREVIEW_MAX_ROWS } from './parseSpreadsheet';

const styles = createStaticStyles(({ css, cssVar }) => ({
  empty: css`
    color: ${cssVar.colorTextDescription};
  `,
  page: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 100%;
    height: 100%;
    min-height: 0;
  `,
  table: css`
    border-collapse: collapse;

    width: max-content;
    min-width: 100%;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.4;
  `,
  td: css`
    overflow: hidden;

    max-width: 240px;
    padding-block: 6px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  th: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    overflow: hidden;

    max-width: 240px;
    padding-block: 6px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};

    font-weight: 600;
    color: ${cssVar.colorText};
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  viewport: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
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
  const truncated =
    sheet.totalRows > sheet.rows.length || sheet.totalCols > SPREADSHEET_PREVIEW_MAX_COLS;

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
        <div className={styles.viewport}>
          <table className={styles.table}>
            {sheet.headers.length > 0 && (
              <thead>
                <tr>
                  {sheet.headers.map((cell, index) => (
                    <th className={styles.th} key={index} title={cell}>
                      {cell || '\u00A0'}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {sheet.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td className={styles.td} key={cellIndex} title={cell}>
                      {cell || '\u00A0'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {truncated && (
        <Text className={styles.empty} fontSize={12}>
          {t('preview.spreadsheet.truncated', {
            shownCols: Math.min(sheet.totalCols, SPREADSHEET_PREVIEW_MAX_COLS),
            shownRows: Math.min(sheet.totalRows, SPREADSHEET_PREVIEW_MAX_ROWS),
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
