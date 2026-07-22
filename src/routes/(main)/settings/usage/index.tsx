'use client';

import { ProviderIcon } from '@lobehub/icons';
import { Avatar, Flexbox, FormGroup, Icon, InputNumber, Tag, Text, Tooltip } from '@lobehub/ui';
import { Button, Modal, Select, toast } from '@lobehub/ui/base-ui';
import { Progress, Table, type TableColumnType } from 'antd';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { ArrowDownToDot, ArrowUpFromDot } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSWRConfig } from 'swr';

import InlineTable from '@/components/InlineTable';
import { getQuotaCycleBounds } from '@/database/models/companyMemberQuota';
import { useMyCompany } from '@/features/Company/hooks';
import { companyModelAllowlistSwrKey } from '@/hooks/useCompanyModelAllowlist';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { parseAsInteger, useQueryParam } from '@/hooks/useQueryParam';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { companyService } from '@/services/company';
import { usageService } from '@/services/usage';
import { type MessageMetadata } from '@/types/message';
import { type UsageRecordItem } from '@/types/usage/usageRecord';
import { formatIntergerNumber } from '@/utils/format';

import { creditsToUsd, usdToCredits } from './credits';

dayjs.extend(utc);

type AllowedModel = { model: string; provider: string };

type MemberQuotaRow = {
  allowedModels: AllowedModel[] | null;
  avatar: string | null;
  email: string | null;
  monthSpend: number;
  monthlyLimitCost: number | null;
  remainingCost: number | null;
  role: string;
  unlimited: boolean;
  userId: string;
  username: string | null;
  workspaceId: string;
};

type MyQuota = {
  allowedModels: AllowedModel[] | null;
  monthSpend: number;
  monthlyLimitCost: number | null;
  remainingCost: number | null;
  unlimited: boolean;
  userId: string;
  workspaceId: string;
} | null;

const modelOptionValue = (provider: string, model: string) => `${provider}:::${model}`;
const parseModelOption = (value: string): AllowedModel => {
  const [provider, model] = value.split(':::');
  return { model, provider };
};

const formatDurationSec = (ms?: number | null) => {
  if (!ms || ms <= 0) return '—';
  return `${(ms / 1000).toFixed(2)}s`;
};

/** Countdown to end of the shared 30-day quota cycle (not calendar month). */
const cycleResetLabel = (t: (key: string, opts?: Record<string, number>) => string) => {
  const now = dayjs.utc();
  const { end } = getQuotaCycleBounds(now.toDate());
  const endAt = dayjs.utc(end);
  const days = Math.max(0, endAt.diff(now, 'day'));
  const hours = Math.max(0, endAt.diff(now, 'hour') % 24);
  if (days <= 0 && hours <= 0) return t('usage.credit.time.hours', { hours: 0 });
  if (days <= 0) return t('usage.credit.time.hours', { hours });
  if (hours <= 0) return t('usage.credit.time.days', { days });
  return t('usage.credit.time.daysAndHours', { days, hours });
};

const CreditUsageTable = memo(() => {
  const { t } = useTranslation('spend');

  const { data, isLoading } = useClientDataSWR(statsKeys.usageLogs(), async () =>
    usageService.findByMonth(),
  );

  const [currentPage, setCurrentPage] = useQueryParam('usagePage', parseAsInteger.withDefault(1), {
    clearOnDefault: true,
  });
  const [pageSize, setPageSize] = useQueryParam('usagePageSize', parseAsInteger.withDefault(10), {
    clearOnDefault: true,
  });

  const columns: TableColumnType<UsageRecordItem>[] = useMemo(
    () => [
      {
        dataIndex: 'createdAt',
        key: 'createdAt',
        render: (value: Date | string) => dayjs(value).format('YYYY-MM-DD HH:mm:ss'),
        sorter: (a, b) => dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf(),
        title: t('table.columns.startTime'),
        width: 170,
      },
      {
        dataIndex: 'type',
        key: 'type',
        render: (value: string) => {
          const key = `table.columns.type.enums.${value}` as const;
          const label = t(key, { defaultValue: value });
          return <Tag color={'blue'}>{label}</Tag>;
        },
        title: t('table.columns.type.title'),
        width: 110,
      },
      {
        key: 'trigger',
        render: (_: unknown, record: UsageRecordItem) => {
          const meta = record.metadata as MessageMetadata | null | undefined;
          const trigger = meta?.trigger || 'chat';
          return t(`table.columns.trigger.enums.${trigger}`, { defaultValue: trigger });
        },
        title: t('table.columns.trigger.title'),
        width: 100,
      },
      {
        dataIndex: 'model',
        key: 'model',
        render: (value: string, record: UsageRecordItem) => (
          <Flexbox horizontal align={'center'} gap={8}>
            <ProviderIcon
              provider={record.provider}
              size={18}
              style={{
                border: `2px solid ${cssVar.colorBgContainer}`,
                boxSizing: 'content-box',
              }}
            />
            <Tooltip title={value}>
              <Text ellipsis style={{ maxWidth: 160 }}>
                {value}
              </Text>
            </Tooltip>
          </Flexbox>
        ),
        title: t('table.columns.model'),
      },
      {
        key: 'tokens',
        render: (_: unknown, record: UsageRecordItem) => {
          const input = record.totalInputTokens ?? 0;
          const output = record.totalOutputTokens ?? 0;
          const total = record.totalTokens ?? input + output;
          return (
            <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
              <Text style={{ color: cssVar.colorSuccess, fontWeight: 500 }}>
                {formatIntergerNumber(total)}
              </Text>
              <Text type={'secondary'}>=</Text>
              <Flexbox
                horizontal
                align={'center'}
                gap={2}
                style={{
                  background: cssVar.colorFillTertiary,
                  borderRadius: 6,
                  padding: '0 6px',
                }}
              >
                <Icon icon={ArrowDownToDot} size={12} />
                <Text fontSize={12}>{formatIntergerNumber(input)}</Text>
              </Flexbox>
              <Text type={'secondary'}>+</Text>
              <Flexbox
                horizontal
                align={'center'}
                gap={2}
                style={{
                  background: cssVar.colorFillTertiary,
                  borderRadius: 6,
                  padding: '0 6px',
                }}
              >
                <Icon icon={ArrowUpFromDot} size={12} />
                <Text fontSize={12}>{formatIntergerNumber(output)}</Text>
              </Flexbox>
            </Flexbox>
          );
        },
        title: t('table.columns.totalTokens'),
        width: 220,
      },
      {
        dataIndex: 'spend',
        key: 'credits',
        render: (value: number) => formatIntergerNumber(usdToCredits(value)),
        sorter: (a, b) => (a.spend || 0) - (b.spend || 0),
        title: t('table.columns.spend'),
        width: 100,
      },
      {
        key: 'duration',
        render: (_: unknown, record: UsageRecordItem) => {
          const meta = record.metadata as MessageMetadata | null | undefined;
          const ms = meta?.performance?.duration ?? meta?.performance?.latency ?? meta?.duration;
          return formatDurationSec(ms);
        },
        title: t('table.columns.duration'),
        width: 90,
      },
    ],
    [t],
  );

  return (
    <InlineTable
      columns={columns}
      dataSource={data}
      loading={isLoading}
      rowKey={(record) => record.id || `${record.model}-${record.createdAt}-${record.provider}`}
      size="small"
      pagination={{
        current: currentPage,
        onChange: (page) => setCurrentPage(page),
        onShowSizeChange: (_current, size) => {
          setCurrentPage(1);
          setPageSize(size);
        },
        pageSize,
        showSizeChanger: true,
      }}
    />
  );
});

const MonthlyCreditUsage = memo<{ quota: MyQuota; loading?: boolean }>(({ quota, loading }) => {
  const { t } = useTranslation('subscription');
  const { t: tSetting } = useTranslation('setting');

  const used = usdToCredits(quota?.monthSpend);
  const limit =
    quota?.unlimited || quota?.monthlyLimitCost == null
      ? null
      : usdToCredits(quota.monthlyLimitCost);
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const resetTime = cycleResetLabel(t);

  return (
    <FormGroup collapsible={false} gap={16} title={t('usage.title')} variant={'filled'}>
      <Flexbox gap={8}>
        <Flexbox horizontal align={'flex-start'} justify={'space-between'}>
          <Flexbox gap={4}>
            <Text fontSize={15} style={{ fontWeight: 500 }}>
              {t('usage.credit.title')}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {t('usage.credit.desc')}
            </Text>
          </Flexbox>
        </Flexbox>

        <Flexbox
          gap={12}
          padding={16}
          style={{
            background: cssVar.colorBgContainer,
            border: `1px solid ${cssVar.colorBorderSecondary}`,
            borderRadius: 12,
          }}
        >
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
            <Flexbox gap={2}>
              <Text fontSize={13} style={{ fontWeight: 500 }}>
                {tSetting('usageQuota.monthlyCredits')}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                {t('usage.credit.free.desc', { time: resetTime })}
              </Text>
            </Flexbox>
            <Text fontSize={13} style={{ fontWeight: 500 }}>
              {loading
                ? tSetting('usageQuota.loading')
                : limit == null
                  ? `${formatIntergerNumber(used)} · ${tSetting('usageQuota.unlimited')}`
                  : `${formatIntergerNumber(used)} / ${formatIntergerNumber(limit)} ${t('usage.used')}`}
            </Text>
          </Flexbox>
          {limit != null && (
            <Progress
              percent={pct}
              showInfo={false}
              strokeColor={pct >= 100 ? cssVar.colorError : undefined}
            />
          )}
          {quota?.allowedModels !== undefined && (
            <Text fontSize={12} type={'secondary'}>
              {tSetting('usageQuota.allowedModels')}:{' '}
              {quota.allowedModels === null
                ? tSetting('usageQuota.allModels')
                : quota.allowedModels.length === 0
                  ? tSetting('usageQuota.noModels')
                  : quota.allowedModels.map((m) => `${m.provider}/${m.model}`).join(', ')}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
    </FormGroup>
  );
});

const EditQuotaModal = memo<{
  modelOptions: { label: string; value: string }[];
  onClose: () => void;
  onSaved: () => void;
  open: boolean;
  row: MemberQuotaRow | null;
  workspaceId: string;
}>(({ open, row, workspaceId, modelOptions, onClose, onSaved }) => {
  const { t } = useTranslation('setting');
  const [credits, setCredits] = useState(0);
  const [unlimited, setUnlimited] = useState(true);
  const [allModels, setAllModels] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!row) return;
    setUnlimited(row.unlimited);
    setCredits(usdToCredits(row.monthlyLimitCost));
    setAllModels(row.allowedModels === null);
    setSelected((row.allowedModels ?? []).map((m) => modelOptionValue(m.provider, m.model)));
  }, [row]);

  const handleSave = async () => {
    if (!row) return;
    try {
      setSaving(true);
      await companyService.upsertMemberQuota({
        allowedModels: allModels ? null : selected.map(parseModelOption),
        monthlyLimitCost: unlimited ? null : creditsToUsd(credits),
        userId: row.userId,
        workspaceId,
      });
      toast.success(t('usageQuota.saved'));
      onSaved();
      onClose();
    } catch {
      toast.error(t('usageQuota.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!row) return;
    try {
      setSaving(true);
      await companyService.clearMemberQuota({ userId: row.userId, workspaceId });
      toast.success(t('usageQuota.reset'));
      onSaved();
      onClose();
    } catch {
      toast.error(t('usageQuota.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      destroyOnHidden
      open={open}
      footer={
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button disabled={saving} onClick={handleClear}>
            {t('usageQuota.resetToDefault')}
          </Button>
          <Button loading={saving} type={'primary'} onClick={handleSave}>
            {t('usageQuota.save')}
          </Button>
        </Flexbox>
      }
      title={t('usageQuota.editTitle', {
        name: row?.username || row?.email || row?.userId,
      })}
      onCancel={onClose}
    >
      <Flexbox gap={16} paddingBlock={8}>
        <Flexbox gap={8}>
          <Text fontSize={13} style={{ fontWeight: 500 }}>
            {t('usageQuota.monthlyCredits')}
          </Text>
          <Flexbox horizontal align={'center'} gap={12}>
            <Select
              style={{ width: 160 }}
              value={unlimited ? 'unlimited' : 'custom'}
              options={[
                { label: t('usageQuota.unlimited'), value: 'unlimited' },
                { label: t('usageQuota.customLimit'), value: 'custom' },
              ]}
              onChange={(v) => setUnlimited(v === 'unlimited')}
            />
            {!unlimited && (
              <InputNumber
                min={0}
                step={1000}
                style={{ width: 180 }}
                value={credits}
                onChange={(v) => setCredits(typeof v === 'number' ? Math.max(0, Math.round(v)) : 0)}
              />
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox gap={8}>
          <Text fontSize={13} style={{ fontWeight: 500 }}>
            {t('usageQuota.allowedModels')}
          </Text>
          <Select
            style={{ width: '100%' }}
            value={allModels ? 'all' : 'custom'}
            options={[
              { label: t('usageQuota.allModels'), value: 'all' },
              { label: t('usageQuota.customModels'), value: 'custom' },
            ]}
            onChange={(v) => setAllModels(v === 'all')}
          />
          {!allModels && (
            <Select
              mode={'multiple'}
              options={modelOptions}
              placeholder={t('usageQuota.selectModels')}
              style={{ width: '100%' }}
              value={selected}
              onChange={(v) => setSelected(v as string[])}
            />
          )}
        </Flexbox>
      </Flexbox>
    </Modal>
  );
});

const UsageQuotaPage = memo(() => {
  const { t } = useTranslation('setting');
  const { t: tSpend } = useTranslation('spend');
  const { data: company } = useMyCompany();
  const isAdmin = company?.role === 'admin' || company?.role === 'owner';
  const enabledProviders = useEnabledChatModels({ skipQuotaFilter: true });
  const { mutate: globalMutate } = useSWRConfig();

  const myQuotaKey = 'company:myQuota';
  const { data: myQuota, isLoading: myLoading } = useClientDataSWR(myQuotaKey, () =>
    companyService.getMyQuota(),
  );

  const membersKey = company?.id ? `company:memberQuotas:${company.id}` : null;
  const {
    data: members,
    isLoading: membersLoading,
    mutate: mutateMembers,
  } = useClientDataSWR(isAdmin && membersKey ? membersKey : null, () =>
    companyService.listMemberQuotas(company!.id),
  );

  const modelOptions = useMemo(() => {
    const options: { label: string; value: string }[] = [];
    for (const provider of enabledProviders) {
      for (const model of provider.children || []) {
        options.push({
          label: `${provider.name || provider.id} / ${model.displayName || model.id}`,
          value: modelOptionValue(provider.id, model.id),
        });
      }
    }
    return options;
  }, [enabledProviders]);

  const [editing, setEditing] = useState<MemberQuotaRow | null>(null);

  const refresh = useCallback(() => {
    void globalMutate(myQuotaKey);
    void globalMutate(companyModelAllowlistSwrKey);
    void mutateMembers();
  }, [globalMutate, mutateMembers]);

  const columns = useMemo(
    () => [
      {
        dataIndex: 'username',
        key: 'user',
        render: (_: unknown, row: MemberQuotaRow) => (
          <Flexbox horizontal align={'center'} gap={8}>
            <Avatar avatar={row.avatar || undefined} size={28} />
            <Flexbox>
              <Text fontSize={13}>{row.username || row.email || row.userId}</Text>
              <Text color={'secondary'} fontSize={11}>
                {row.role}
              </Text>
            </Flexbox>
          </Flexbox>
        ),
        title: t('usageQuota.member'),
      },
      {
        dataIndex: 'monthSpend',
        key: 'spend',
        render: (v: number) => formatIntergerNumber(usdToCredits(v)),
        title: t('usageQuota.monthSpend'),
        width: 120,
      },
      {
        dataIndex: 'monthlyLimitCost',
        key: 'limit',
        render: (_: unknown, row: MemberQuotaRow) =>
          row.unlimited
            ? t('usageQuota.unlimited')
            : formatIntergerNumber(usdToCredits(row.monthlyLimitCost)),
        title: t('usageQuota.monthlyCredits'),
        width: 130,
      },
      {
        dataIndex: 'allowedModels',
        key: 'models',
        render: (models: AllowedModel[] | null) =>
          models === null
            ? t('usageQuota.allModels')
            : models.length === 0
              ? t('usageQuota.noModels')
              : t('usageQuota.modelCount', { count: models.length }),
        title: t('usageQuota.allowedModels'),
      },
      {
        key: 'actions',
        render: (_: unknown, row: MemberQuotaRow) => (
          <Button size={'small'} onClick={() => setEditing(row)}>
            {t('usageQuota.edit')}
          </Button>
        ),
        title: '',
        width: 90,
      },
    ],
    [t],
  );

  return (
    <>
      <SettingHeader desc={t('usageQuota.desc')} title={t('tab.usage')} />

      <Flexbox gap={24} paddingBlock={8}>
        <FormGroup
          collapsible={false}
          desc={tSpend('table.desc')}
          gap={12}
          title={tSpend('table.title')}
          variant={'filled'}
        >
          <CreditUsageTable />
        </FormGroup>

        <MonthlyCreditUsage loading={myLoading} quota={(myQuota as MyQuota) ?? null} />

        {!company && !myLoading && (
          <Text color={'secondary'} fontSize={13}>
            {t('usageQuota.noCompany')}
          </Text>
        )}

        {isAdmin && company && (
          <FormGroup collapsible={false} title={t('usageQuota.memberQuotas')} variant={'filled'}>
            <Table
              columns={columns as any}
              dataSource={(members as MemberQuotaRow[] | undefined) ?? []}
              loading={membersLoading}
              pagination={false}
              rowKey={'userId'}
              size={'small'}
            />
          </FormGroup>
        )}
      </Flexbox>

      {company && (
        <EditQuotaModal
          modelOptions={modelOptions}
          open={!!editing}
          row={editing}
          workspaceId={company.id}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
});

export default UsageQuotaPage;
