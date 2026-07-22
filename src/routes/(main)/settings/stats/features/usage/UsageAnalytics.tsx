'use client';

import { FormGroup, Icon } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { ProviderIcon } from '@lobehub/ui/icons';
import { type DatePickerProps } from 'antd';
import { DatePicker, Divider } from 'antd';
import dayjs from 'dayjs';
import { Brain, UserIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { usageService } from '@/services/usage';

import { GroupBy, type UserDisplayResolver } from '../../types';
import { ToolUsageSection } from '../toolUsage';
import UsageCards from './UsageCards';
import UsageTable from './UsageTable';
import UsageTrends from './UsageTrends';

export interface UsageAnalyticsProps {
  /**
   * Enable the "By User" group-by dimension. Only meaningful when multiple
   * users contribute to the data (workspace admin).
   */
  enableUserDimension?: boolean;
  /** Resolve userId → display info. Required when `enableUserDimension` is true. */
  resolveUser?: UserDisplayResolver;
  /** Override the FormGroup title. Defaults to auth `tab.usage`. */
  title?: string;
}

/**
 * LobeHub usage analytics block (cards + trends + table + tool usage).
 * Shared by Stats and the company Quota Allocation page.
 */
const UsageAnalytics = memo<UsageAnalyticsProps>(({ enableUserDimension, resolveUser, title }) => {
  const { t, i18n } = useTranslation('auth');
  dayjs.locale(i18n.language);

  const [groupBy, setGroupBy] = useState<GroupBy>(GroupBy.Model);
  const [dateRange, setDateRange] = useState<dayjs.Dayjs>(() => dayjs(new Date()));
  const [dateStrings, setDateStrings] = useState<string>();

  const { data, isLoading, error, mutate } = useClientDataSWR(statsKeys.usageStat(), async () =>
    usageService.findAndGroupByDay(dateStrings),
  );

  useEffect(() => {
    if (dateStrings) {
      mutate();
    }
  }, [dateStrings, mutate]);

  const handleDateChange: DatePickerProps['onChange'] = (dates, nextDateStrings) => {
    const actualDate = Array.isArray(dates) ? dates[0] : dates;
    if (actualDate) {
      setDateRange(actualDate);
    }
    if (typeof nextDateStrings === 'string') {
      setDateStrings(nextDateStrings);
    }
  };

  return (
    <FormGroup
      collapsible={false}
      gap={16}
      title={title ?? t('tab.usage')}
      variant={'filled'}
      extra={
        <>
          <DatePicker picker="month" value={dateRange} onChange={handleDateChange} />
          <Tabs
            activeKey={groupBy}
            style={{ marginLeft: 8 }}
            items={[
              {
                icon: <Icon icon={Brain} />,
                key: GroupBy.Model,
                label: t('usage.welcome.model'),
              },
              {
                icon: <Icon icon={ProviderIcon} />,
                key: GroupBy.Provider,
                label: t('usage.welcome.provider'),
              },
              ...(enableUserDimension
                ? [
                    {
                      icon: <Icon icon={UserIcon} />,
                      key: GroupBy.User,
                      label: t('usage.welcome.user'),
                    },
                  ]
                : []),
            ]}
            onChange={(key) => setGroupBy(key as GroupBy)}
          />
        </>
      }
      styles={{
        title: { lineHeight: '35px' },
      }}
    >
      <AsyncBoundary data={data} error={error} errorVariant={'block'} onRetry={() => mutate()}>
        <UsageCards data={data} groupBy={groupBy} isLoading={isLoading} resolveUser={resolveUser} />
        <Divider />
        <UsageTrends
          data={data}
          groupBy={groupBy}
          isLoading={isLoading}
          resolveUser={resolveUser}
        />
      </AsyncBoundary>
      <div style={{ height: 24 }} />
      <UsageTable dateStrings={dateStrings} />
      <Divider dashed style={{ marginBlock: 24 }} />
      <ToolUsageSection
        dateStrings={dateStrings}
        enableUserDimension={enableUserDimension}
        resolveUser={resolveUser}
      />
    </FormGroup>
  );
});

UsageAnalytics.displayName = 'UsageAnalytics';

export default UsageAnalytics;
