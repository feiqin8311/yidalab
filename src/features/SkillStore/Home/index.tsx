'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Table } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ASSISTANT_CATALOG, type CatalogRow, MCP_CATALOG, SKILL_CATALOG } from './catalog';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    overflow: auto;

    width: 100%;
    height: 100%;
    min-height: 60vh;
    padding-block: 8px 24px;
    padding-inline: 4px;
  `,
  section: css`
    margin-block-end: 20px;
  `,
  table: css`
    .ant-table {
      font-size: 13px;
      background: transparent;
    }

    .ant-table-thead > tr > th {
      font-weight: 600;
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

const CatalogTable = memo<{
  nameTitle: string;
  purposeTitle: string;
  relatedTitle: string;
  rows: CatalogRow[];
}>(({ nameTitle, purposeTitle, relatedTitle, rows }) => {
  const columns = useMemo(
    () => [
      {
        dataIndex: 'name',
        key: 'name',
        title: nameTitle,
        width: '24%',
        render: (v: string) => (
          <Text fontSize={13} style={{ fontWeight: 500 }}>
            {v}
          </Text>
        ),
      },
      {
        dataIndex: 'purpose',
        key: 'purpose',
        title: purposeTitle,
        width: '38%',
      },
      {
        dataIndex: 'related',
        key: 'related',
        title: relatedTitle,
        width: '38%',
        render: (v: string) => (
          <Text fontSize={12} type={'secondary'}>
            {v}
          </Text>
        ),
      },
    ],
    [nameTitle, purposeTitle, relatedTitle],
  );

  return (
    <div className={styles.table}>
      <Table
        columns={columns}
        dataSource={rows}
        pagination={false}
        rowKey={'name'}
        size={'small'}
      />
    </div>
  );
});

const Section = memo<{
  children: ReactNode;
  title: string;
}>(({ title, children }) => (
  <div className={styles.section}>
    <Text fontSize={15} style={{ fontWeight: 600, marginBottom: 10, display: 'block' }}>
      {title}
    </Text>
    {children}
  </div>
));

/**
 * Skill Store home: catalog of company assistants (scenarios), skills, and MCPs.
 */
const SkillStoreHome = memo(() => {
  const { t } = useTranslation('setting');

  const colName = t('skillStore.home.col.name');
  const colPurpose = t('skillStore.home.col.purpose');
  const colRelated = t('skillStore.home.col.related');

  return (
    <div className={styles.root}>
      <Flexbox gap={4} style={{ marginBottom: 16 }}>
        <Text fontSize={16} style={{ fontWeight: 600 }}>
          {t('skillStore.home.title')}
        </Text>
        <Text fontSize={13} type={'secondary'}>
          {t('skillStore.home.desc')}
        </Text>
      </Flexbox>

      <Section title={t('skillStore.home.assistants')}>
        {ASSISTANT_CATALOG.length === 0 ? (
          <Text fontSize={13} type={'secondary'}>
            {t('skillStore.home.assistants.empty')}
          </Text>
        ) : (
          <CatalogTable
            nameTitle={t('skillStore.home.col.assistant')}
            purposeTitle={colPurpose}
            relatedTitle={colRelated}
            rows={ASSISTANT_CATALOG}
          />
        )}
      </Section>

      <Section title={t('skillStore.home.skills')}>
        <CatalogTable
          nameTitle={colName}
          purposeTitle={colPurpose}
          relatedTitle={colRelated}
          rows={SKILL_CATALOG}
        />
      </Section>

      <Section title={t('skillStore.home.mcp')}>
        <CatalogTable
          nameTitle={t('skillStore.home.col.mcp')}
          purposeTitle={colPurpose}
          relatedTitle={colRelated}
          rows={MCP_CATALOG}
        />
      </Section>
    </div>
  );
});

SkillStoreHome.displayName = 'SkillStoreHome';

export default SkillStoreHome;
