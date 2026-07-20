'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Empty, Spin } from 'antd';
import { createStaticStyles } from 'antd-style';
import { type FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { usePermission } from '@/hooks/usePermission';

import CredItem from './CredItem';
import { createEditCredModal } from './EditCredModal';
import { useCredsApi } from './useCredsApi';
import { createViewCredModal } from './ViewCredModal';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 24px;
  `,
  empty: css`
    padding-block: 48px;
    padding-inline: 0;
  `,
  sectionDesc: css`
    margin-block-end: 8px;
    font-size: 13px;
    color: var(--lobe-color-text-secondary);
  `,
  sectionTitle: css`
    margin-block-end: 4px;
    font-size: 16px;
    font-weight: 600;
  `,
}));

interface CredSectionProps {
  creds: UserCredSummary[];
  desc: string;
  emptyText: string;
  onDelete: (id: number) => void;
  onEdit: (cred: UserCredSummary) => void;
  onView: (cred: UserCredSummary) => void;
  title: string;
}

const CredSection: FC<CredSectionProps> = ({
  title,
  desc,
  creds,
  emptyText,
  onDelete,
  onEdit,
  onView,
}) => (
  <div>
    <Text className={styles.sectionTitle}>{title}</Text>
    <Text className={styles.sectionDesc}>{desc}</Text>
    {creds.length === 0 ? (
      <Empty className={styles.empty} description={emptyText} />
    ) : (
      <Flexbox gap={0}>
        {creds.map((cred) => (
          <CredItem cred={cred} key={cred.id} onDelete={onDelete} onEdit={onEdit} onView={onView} />
        ))}
      </Flexbox>
    )}
  </div>
);

const CredsList: FC = () => {
  const { t } = useTranslation('setting');
  const { allowed: canManageCredentials } = usePermission('manage_provider_key');
  const credsApi = useCredsApi();

  // Backfill market/installed MCP secrets into the vault once per page open.
  const syncQuery = useQuery({
    queryFn: async () => {
      const client = credsApi.client as typeof credsApi.client & {
        syncFromMcps?: { mutate: () => Promise<unknown> };
      };
      if (typeof client.syncFromMcps?.mutate === 'function') {
        await client.syncFromMcps.mutate();
      }
      return true;
    },
    queryKey: ['localCreds', 'syncFromMcps'],
    staleTime: 60_000,
  });

  const { data, error, isLoading, refetch } = credsApi.query.list.useQuery(undefined, {
    enabled: !syncQuery.isLoading,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await credsApi.client.delete.mutate({ id });
    },
    onSuccess: () => {
      refetch();
    },
  });

  const credentials = useMemo(() => data?.data ?? [], [data?.data]);
  const companyCreds = useMemo(
    () => credentials.filter((c) => c.scope === 'company'),
    [credentials],
  );
  const personalCreds = useMemo(
    () => credentials.filter((c) => c.scope !== 'company'),
    [credentials],
  );

  const handleEdit = (cred: UserCredSummary) => {
    if (cred.canManage === false) return;
    if (!canManageCredentials && cred.scope !== 'company') return;
    createEditCredModal({
      cred,
      credsApi,
      onSuccess: () => refetch(),
    });
  };

  const handleView = (cred: UserCredSummary) => {
    if (cred.canManage === false) return;
    createViewCredModal({ cred, credsApi });
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(id);
  };

  const listMeta = data as
    | { canManageCompany?: boolean; companyWorkspaceId?: string | null; data?: UserCredSummary[] }
    | undefined;
  const showCompanySection = Boolean(listMeta?.companyWorkspaceId || companyCreds.length > 0);

  return (
    <div className={styles.container}>
      <AsyncBoundary
        data={data}
        empty={null}
        error={error}
        errorVariant={'block'}
        isEmpty={false}
        isLoading={isLoading || syncQuery.isLoading}
        loading={
          <Flexbox align={'center'} justify={'center'} style={{ padding: 48 }}>
            <Spin />
          </Flexbox>
        }
        onRetry={() => refetch()}
      >
        {showCompanySection && (
          <CredSection
            creds={companyCreds}
            desc={t('creds.companySection.desc')}
            emptyText={t('creds.companySection.empty')}
            title={t('creds.companySection.title')}
            onDelete={handleDelete}
            onEdit={handleEdit}
            onView={handleView}
          />
        )}
        <CredSection
          creds={personalCreds}
          desc={t('creds.personalSection.desc')}
          emptyText={t('creds.empty')}
          title={t('creds.personalSection.title')}
          onDelete={handleDelete}
          onEdit={handleEdit}
          onView={handleView}
        />
      </AsyncBoundary>
    </div>
  );
};

export default CredsList;
