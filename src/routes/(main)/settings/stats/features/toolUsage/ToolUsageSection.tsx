'use client';

import { BarList } from '@lobehub/charts';
import { Flexbox, Grid, Text } from '@lobehub/ui';
import { type TableColumnType } from 'antd';
import dayjs from 'dayjs';
import { memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import InlineTable from '@/components/InlineTable';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { usageService } from '@/services/usage';
import { type ToolUsageStats } from '@/types/usage/usageRecord';
import { formatIntergerNumber } from '@/utils/format';

import { type UserDisplayResolver } from '../../types';
import StatsFormGroup from '../components/StatsFormGroup';
import TotalCard from '../overview/ShareButton/TotalCard';
import { toolDisplayName } from './toolDisplayName';

interface ToolUsageSectionProps {
  /** YYYY-MM month string from the shared DatePicker; empty = current month */
  dateStrings?: string;
  enableUserDimension?: boolean;
  resolveUser?: UserDisplayResolver;
}

const emptyStats: ToolUsageStats = {
  byApi: [],
  bySkill: [],
  byTool: [],
  byUser: [],
  summary: {
    companyMcpCalls: 0,
    failedCalls: 0,
    skillActivations: 0,
    totalCalls: 0,
  },
};

const ToolUsageSection = memo<ToolUsageSectionProps>(
  ({ dateStrings, enableUserDimension, resolveUser }) => {
    const { t } = useTranslation('auth');

    const { startAt, endAt } = useMemo(() => {
      const base =
        dateStrings && dayjs(dateStrings, 'YYYY-MM', true).isValid()
          ? dayjs(dateStrings, 'YYYY-MM')
          : dayjs();
      return {
        endAt: base.endOf('month').format('YYYY-MM-DD'),
        startAt: base.startOf('month').format('YYYY-MM-DD'),
      };
    }, [dateStrings]);

    const { data, isLoading, error, mutate } = useClientDataSWR(
      statsKeys.toolUsageStat(startAt, endAt),
      async () => usageService.getToolUsageStats({ endAt, startAt }),
    );

    useEffect(() => {
      void mutate();
    }, [startAt, endAt, mutate]);

    const stats = data ?? emptyStats;

    const toolBarData = useMemo(
      () =>
        stats.byTool.slice(0, 8).map((item) => ({
          id: item.identifier,
          name: toolDisplayName(item.identifier),
          value: item.calls,
        })),
      [stats.byTool],
    );

    const skillBarData = useMemo(
      () =>
        stats.bySkill.slice(0, 8).map((item) => ({
          id: item.name,
          name: item.name,
          value: item.activations,
        })),
      [stats.bySkill],
    );

    const apiColumns: TableColumnType<(typeof stats.byApi)[number]>[] = [
      {
        dataIndex: 'identifier',
        key: 'identifier',
        render: (id: string) => toolDisplayName(id),
        title: t('toolUsage.table.tool'),
      },
      {
        dataIndex: 'apiName',
        key: 'apiName',
        title: t('toolUsage.table.api'),
      },
      {
        dataIndex: 'calls',
        key: 'calls',
        title: t('toolUsage.table.calls'),
        width: 100,
      },
      {
        dataIndex: 'failed',
        key: 'failed',
        title: t('toolUsage.table.failed'),
        width: 100,
      },
    ];

    const userColumns: TableColumnType<(typeof stats.byUser)[number]>[] = [
      {
        dataIndex: 'userId',
        key: 'userId',
        render: (userId: string) => resolveUser?.(userId)?.name ?? userId,
        title: t('toolUsage.table.user'),
      },
      {
        dataIndex: 'calls',
        key: 'calls',
        title: t('toolUsage.table.calls'),
        width: 100,
      },
      {
        dataIndex: 'failed',
        key: 'failed',
        title: t('toolUsage.table.failed'),
        width: 100,
      },
    ];

    return (
      <StatsFormGroup fontSize={16} title={t('toolUsage.title')}>
        <Text fontSize={13} type="secondary">
          {t('toolUsage.hint')}
        </Text>
        <AsyncBoundary
          data={data ?? emptyStats}
          error={error}
          errorVariant="block"
          onRetry={() => mutate()}
        >
          <Grid gap={8} maxItemWidth={150} rows={4}>
            <TotalCard
              count={formatIntergerNumber(stats.summary.totalCalls)}
              title={t('toolUsage.cards.totalCalls')}
            />
            <TotalCard
              count={formatIntergerNumber(stats.summary.failedCalls)}
              title={t('toolUsage.cards.failedCalls')}
            />
            <TotalCard
              count={formatIntergerNumber(stats.summary.skillActivations)}
              title={t('toolUsage.cards.skillActivations')}
            />
            <TotalCard
              count={formatIntergerNumber(stats.summary.companyMcpCalls)}
              title={t('toolUsage.cards.companyMcpCalls')}
            />
          </Grid>

          <Grid gap={16} rows={2} style={{ marginTop: 8 }}>
            <Flexbox gap={8}>
              <Text weight={500}>{t('toolUsage.toolsRank.title')}</Text>
              <BarList
                data={toolBarData}
                height={220}
                leftLabel={t('toolUsage.toolsRank.left')}
                loading={isLoading && !data}
                rightLabel={t('toolUsage.toolsRank.right')}
                noDataText={{
                  desc: t('stats.empty.desc'),
                  title: t('stats.empty.title'),
                }}
              />
            </Flexbox>
            <Flexbox gap={8}>
              <Text weight={500}>{t('toolUsage.skillsRank.title')}</Text>
              <BarList
                data={skillBarData}
                height={220}
                leftLabel={t('toolUsage.skillsRank.left')}
                loading={isLoading && !data}
                rightLabel={t('toolUsage.skillsRank.right')}
                noDataText={{
                  desc: t('toolUsage.skillsRank.emptyDesc'),
                  title: t('toolUsage.skillsRank.emptyTitle'),
                }}
              />
            </Flexbox>
          </Grid>

          <div style={{ marginTop: 12 }}>
            <Text weight={500}>{t('toolUsage.apiTable.title')}</Text>
            <InlineTable
              columns={apiColumns}
              dataSource={stats.byApi}
              loading={isLoading && !data}
              pagination={false}
              rowKey={(r) => `${r.identifier}:${r.apiName}`}
              size="small"
              style={{ marginTop: 8 }}
            />
          </div>

          {enableUserDimension && (
            <div style={{ marginTop: 16 }}>
              <Text weight={500}>{t('toolUsage.userTable.title')}</Text>
              <InlineTable
                columns={userColumns}
                dataSource={stats.byUser}
                loading={isLoading && !data}
                pagination={false}
                rowKey="userId"
                size="small"
                style={{ marginTop: 8 }}
              />
            </div>
          )}
        </AsyncBoundary>
      </StatsFormGroup>
    );
  },
);

ToolUsageSection.displayName = 'ToolUsageSection';

export default ToolUsageSection;
