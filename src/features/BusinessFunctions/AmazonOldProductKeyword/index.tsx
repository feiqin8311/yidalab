'use client';

import { VIEW_SHEET_NAMES, type ViewId } from '@lobechat/utils';
import { Block, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowLeftIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import ModelSelect from '@/features/ModelSelect';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useIsMobile } from '@/hooks/useIsMobile';
import { businessFunctionService } from '@/services/businessFunction';

const styles = createStaticStyles(({ css }) => ({
  page: css`
    width: 100%;
    max-width: 1200px;
    margin-block: 0;
    margin-inline: auto;
    padding-block: 24px 48px;
    padding-inline: 16px;
  `,
  wide: css`
    max-width: 1400px;
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  formGrid: css`
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;

    @media (width >= 768px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  `,
  dropZone: css`
    cursor: pointer;

    padding: 24px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: 12px;

    text-align: center;

    background: ${cssVar.colorFillQuaternary};

    &:hover {
      border-color: ${cssVar.colorPrimary};
    }
  `,
  tableWrap: css`
    overflow: auto;
    max-width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
  `,
  table: css`
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;

    th,
    td {
      overflow: hidden;

      max-width: 280px;
      padding-block: 8px;
      padding-inline: 10px;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};

      text-align: start;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    th {
      position: sticky;
      z-index: 1;
      inset-block-start: 0;

      font-weight: 600;

      background: ${cssVar.colorBgContainer};
    }

    th:first-child,
    td:first-child {
      position: sticky;
      z-index: 2;
      inset-inline-start: 0;
      background: ${cssVar.colorBgContainer};
    }
  `,
  nav: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  `,
  navBtn: css`
    font-size: 12px;
  `,
  iconWrap: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: 12px;

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  statusBadge: css`
    display: inline-flex;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;

    background: ${cssVar.colorFillSecondary};
  `,
}));

const ROLE_LABELS: Record<string, string> = {
  product_html: '产品调研HTML',
  historical_terms: '领星历史出单词',
  sp_search_terms_daily: 'SP搜索词(每日)',
  sp_targeting: 'SP投放',
  sp_impression_share: 'SP展示量份额',
  sb_search_terms_daily: 'SB搜索词(每日)',
  multi_asin: '多ASIN反查',
};

const DECISION_VIEWS: ViewId[] = [
  'overview',
  'high_win',
  'new_opportunity',
  'low_efficiency',
  'history_sleep',
  'competitor_gap',
  'asin_negative',
];
const ANALYSIS_VIEWS: ViewId[] = ['full_lexicon', 'brand_ads', 'sp_targeting', 'daily_trend'];
const META_VIEWS: ViewId[] = ['scoring_rules', 'data_sources'];

const Card = memo(
  ({ title, children, extra }: { children: ReactNode; extra?: ReactNode; title: string }) => (
    <Block padding={16} variant={'outlined'}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text fontSize={15} weight={600}>
            {title}
          </Text>
          {extra}
        </Flexbox>
        {children}
      </Flexbox>
    </Block>
  ),
);

const StatusText = memo(({ status }: { status: string }) => (
  <span className={styles.statusBadge}>{status}</span>
));

/** List + create entry for the feature home. */
export const AmazonOldProductKeywordPage = memo(() => {
  const { t } = useTranslation('common');
  const workspaceId = useActiveWorkspaceId() ?? undefined;
  const workspaceSlug = useActiveWorkspaceSlug();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const [creating, setCreating] = useState(false);

  const { data, mutate, isLoading } = useSWR(
    workspaceId ? ['amazon-kw-runs', workspaceId] : null,
    () => businessFunctionService.amazonKw.listRuns({ workspaceId: workspaceId!, limit: 50 }),
    { refreshInterval: 5000 },
  );

  const openCreate = () => {
    if (mobile) {
      toast.info(t('businessFunctions.amazonKw.mobileCreateHint'));
      return;
    }
    setCreating(true);
  };

  if (!workspaceId) {
    return (
      <div className={styles.page}>
        <Text type={'secondary'}>{t('businessFunctions.amazonKw.error.workspaceOnly')}</Text>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Flexbox gap={20}>
        <Flexbox horizontal align={'center'} gap={12}>
          <WorkspaceLink to="/functions">
            <Button icon={ArrowLeftIcon} size={'small'} type={'text'} />
          </WorkspaceLink>
          <div className={styles.iconWrap}>
            <Icon icon={FileSpreadsheetIcon} size={20} />
          </div>
          <Flexbox flex={1} gap={2}>
            <Text fontSize={18} weight={600}>
              {t('businessFunctions.amazonKw.name')}
            </Text>
            <Text fontSize={13} type={'secondary'}>
              {t('businessFunctions.amazonKw.detailDesc')}
            </Text>
          </Flexbox>
          {!mobile && (
            <Button icon={PlusIcon} type={'primary'} onClick={openCreate}>
              {t('businessFunctions.amazonKw.create')}
            </Button>
          )}
        </Flexbox>

        {creating && !mobile && (
          <CreateWizard
            workspaceId={workspaceId}
            onCancel={() => setCreating(false)}
            onStarted={(runId) => {
              setCreating(false);
              void mutate();
              navigate(
                buildWorkspaceAwarePath(
                  `/functions/amazon-old-product-keyword-analysis/${runId}`,
                  workspaceSlug,
                ),
              );
            }}
          />
        )}

        <Card
          title={t('businessFunctions.amazonKw.history')}
          extra={
            <Button icon={RefreshCwIcon} size={'small'} type={'text'} onClick={() => mutate()} />
          }
        >
          {isLoading && <Text type={'secondary'}>…</Text>}
          {!isLoading && !data?.rows?.length && (
            <Text type={'secondary'}>{t('businessFunctions.amazonKw.emptyHistory')}</Text>
          )}
          <Flexbox gap={8}>
            {(data?.rows ?? []).map((run: any) => (
              <Block key={run.id} padding={12} variant={'outlined'}>
                <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
                  <Flexbox gap={4}>
                    <Text weight={600}>
                      {run.categoryName || '-'} · {run.mainAsin || '-'}
                    </Text>
                    <Flexbox horizontal gap={8}>
                      <StatusText status={run.status} />
                      <Text fontSize={12} type={'secondary'}>
                        {run.progress?.message || run.stage}
                      </Text>
                    </Flexbox>
                  </Flexbox>
                  <Flexbox horizontal gap={8}>
                    <WorkspaceLink to={`/functions/amazon-old-product-keyword-analysis/${run.id}`}>
                      <Button size={'small'}>{t('businessFunctions.amazonKw.open')}</Button>
                    </WorkspaceLink>
                    {['draft', 'failed', 'succeeded', 'canceled'].includes(run.status) && (
                      <Button
                        danger
                        icon={Trash2Icon}
                        size={'small'}
                        type={'text'}
                        onClick={async () => {
                          if (!confirm(t('businessFunctions.amazonKw.confirmDelete'))) return;
                          await businessFunctionService.amazonKw.delete({
                            workspaceId,
                            runId: run.id,
                          });
                          void mutate();
                        }}
                      />
                    )}
                  </Flexbox>
                </Flexbox>
              </Block>
            ))}
          </Flexbox>
        </Card>
      </Flexbox>
    </div>
  );
});

AmazonOldProductKeywordPage.displayName = 'AmazonOldProductKeywordPage';

const CreateWizard = memo(
  ({
    workspaceId,
    onCancel,
    onStarted,
  }: {
    workspaceId: string;
    onCancel: () => void;
    onStarted: (runId: string) => void;
  }) => {
    const { t } = useTranslation('common');
    const [step, setStep] = useState(1);
    const [mainAsin, setMainAsin] = useState('');
    const [categoryName, setCategoryName] = useState('');
    const [priceUsd, setPriceUsd] = useState('12');
    const [model, setModel] = useState<{ model: string; provider: string }>({
      model: '',
      provider: '',
    });
    const [runId, setRunId] = useState<string | null>(null);
    const [files, setFiles] = useState<
      { file: File; role: string; status: 'pending' | 'uploading' | 'done' | 'error' }[]
    >([]);
    const [busy, setBusy] = useState(false);
    const [audit, setAudit] = useState<any>(null);

    const onPickFiles = async (list: FileList | null) => {
      if (!list?.length) return;
      const arr = [...list];
      const guessed = await businessFunctionService.amazonKw.guessRoles({
        workspaceId,
        fileNames: arr.map((f) => f.name),
      });
      setFiles((prev) => [
        ...prev,
        ...arr.map((file, i) => ({
          file,
          role: guessed[i]?.role || 'sp_search_terms_daily',
          status: 'pending' as const,
        })),
      ]);
    };

    const createAndUpload = async () => {
      if (!mainAsin || !categoryName || !priceUsd || !model.model || !model.provider) {
        toast.error(t('businessFunctions.amazonKw.error.required'));
        return;
      }
      setBusy(true);
      try {
        const run = await businessFunctionService.amazonKw.createDraft({
          workspaceId,
          mainAsin,
          categoryName,
          priceUsd: Number(priceUsd),
          model: { model: model.model, provider: model.provider },
        });
        setRunId(run.id);

        const next = [...files];
        for (let i = 0; i < next.length; i++) {
          const item = next[i]!;
          next[i] = { ...item, status: 'uploading' };
          setFiles([...next]);
          try {
            const { s3Key, url, headers } = await businessFunctionService.amazonKw.createUploadUrl({
              workspaceId,
              runId: run.id,
              role: item.role,
              fileName: item.file.name,
              contentType: item.file.type || undefined,
            });
            await fetch(url, {
              method: 'PUT',
              body: item.file,
              headers: headers as any,
            });
            await businessFunctionService.amazonKw.confirmUpload({
              workspaceId,
              runId: run.id,
              role: item.role,
              fileName: item.file.name,
              s3Key,
            });
            next[i] = { ...item, status: 'done' };
          } catch {
            next[i] = { ...item, status: 'error' };
          }
          setFiles([...next]);
        }

        const a = await businessFunctionService.amazonKw.auditInputs({
          workspaceId,
          runId: run.id,
        });
        setAudit(a);
        setStep(3);
      } catch (e: any) {
        toast.error(e?.message || t('businessFunctions.amazonKw.error.unknown'));
      } finally {
        setBusy(false);
      }
    };

    const start = async () => {
      if (!runId) return;
      setBusy(true);
      try {
        await businessFunctionService.amazonKw.start({ workspaceId, runId });
        toast.success(t('businessFunctions.amazonKw.started'));
        onStarted(runId);
      } catch (e: any) {
        toast.error(e?.message || t('businessFunctions.amazonKw.error.unknown'));
      } finally {
        setBusy(false);
      }
    };

    return (
      <Card
        title={t('businessFunctions.amazonKw.create')}
        extra={
          <Button size={'small'} type={'text'} onClick={onCancel}>
            取消
          </Button>
        }
      >
        <Flexbox gap={16}>
          <Text type={'secondary'}>
            Step {step}/3 · {step === 1 ? '基础信息' : step === 2 ? '上传数据源' : '确认并启动'}
          </Text>

          {step === 1 && (
            <Flexbox gap={12}>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <Text fontSize={13}>主ASIN</Text>
                  <Input
                    placeholder="B0XXXXXXXX"
                    value={mainAsin}
                    onChange={(e) => setMainAsin(e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <Text fontSize={13}>品类名称</Text>
                  <Input
                    placeholder="儿童剪刀"
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <Text fontSize={13}>售价(USD)</Text>
                  <Input value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <Text fontSize={13}>AI 模型</Text>
                  <ModelSelect
                    value={model.model ? model : undefined}
                    onChange={(v) => setModel({ model: v.model, provider: v.provider })}
                  />
                </div>
              </div>
              <Text fontSize={12} type={'secondary'}>
                站点固定 Amazon 美国站。默认阈值：目标ACoS 35%、高风险ACoS
                70%、无单花费=售价×50%、无单点击8。
              </Text>
              <Button
                type={'primary'}
                onClick={() => {
                  if (!mainAsin || !categoryName || !priceUsd || !model.model) {
                    toast.error(t('businessFunctions.amazonKw.error.required'));
                    return;
                  }
                  setStep(2);
                }}
              >
                下一步
              </Button>
            </Flexbox>
          )}

          {step === 2 && (
            <Flexbox gap={12}>
              <label className={styles.dropZone}>
                <input
                  hidden
                  multiple
                  accept=".xlsx,.xls,.csv,.html,.htm"
                  type="file"
                  onChange={(e) => void onPickFiles(e.target.files)}
                />
                <Text>拖入或点击选择 7 类数据源文件（可批量）</Text>
                <Text fontSize={12} type={'secondary'}>
                  必填：产品调研HTML +（历史出单词 或 SP搜索词）
                </Text>
              </label>
              {files.map((f, i) => (
                <Flexbox horizontal align={'center'} gap={8} key={`${f.file.name}-${i}`}>
                  <Text style={{ flex: 1 }}>{f.file.name}</Text>
                  <select
                    value={f.role}
                    onChange={(e) => {
                      const next = [...files];
                      next[i] = { ...f, role: e.target.value };
                      setFiles(next);
                    }}
                  >
                    {Object.entries(ROLE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <Text fontSize={12} type={'secondary'}>
                    {f.status}
                  </Text>
                </Flexbox>
              ))}
              <Flexbox horizontal gap={8}>
                <Button onClick={() => setStep(1)}>上一步</Button>
                <Button loading={busy} type={'primary'} onClick={() => void createAndUpload()}>
                  上传并审计
                </Button>
              </Flexbox>
            </Flexbox>
          )}

          {step === 3 && (
            <Flexbox gap={12}>
              <Text>
                预计 AI 批次数：{audit?.estimatedBatches ?? '-'} · 缺失：
                {(audit?.missing ?? []).join(', ') || '无'}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                将使用模型 {model.provider}/{model.model}{' '}
                生成语义档案与关键词相关性评分；清洗/标签/对账为固定规则。
              </Text>
              <Flexbox horizontal gap={8}>
                <Button onClick={() => setStep(2)}>上一步</Button>
                <Button loading={busy} type={'primary'} onClick={() => void start()}>
                  开始分析
                </Button>
              </Flexbox>
            </Flexbox>
          )}
        </Flexbox>
      </Card>
    );
  },
);

/** Run detail: progress + 13 views + export. */
export const AmazonOldProductKeywordRunPage = memo(() => {
  const { t } = useTranslation('common');
  const { runId } = useParams<{ runId: string }>();
  const workspaceId = useActiveWorkspaceId() ?? undefined;
  const [viewId, setViewId] = useState<ViewId>('overview');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [exporting, setExporting] = useState(false);

  const active =
    workspaceId && runId
      ? (['draft', 'auditing', 'queued', 'running', 'exporting'] as string[])
      : [];

  const { data: run, mutate } = useSWR(
    workspaceId && runId ? ['amazon-kw-run', workspaceId, runId] : null,
    () => businessFunctionService.amazonKw.getRun({ workspaceId: workspaceId!, runId: runId! }),
    {
      refreshInterval: (latest) => (latest && active.includes(latest.status) ? 2500 : 0),
    },
  );

  const { data: rowsData, isLoading: rowsLoading } = useSWR(
    workspaceId && runId && run?.status === 'succeeded'
      ? ['amazon-kw-rows', workspaceId, runId, viewId, search, page]
      : null,
    () =>
      businessFunctionService.amazonKw.listResultRows({
        workspaceId: workspaceId!,
        runId: runId!,
        viewId,
        search: search || undefined,
        limit: pageSize,
        offset: page * pageSize,
        sortBy: 'orders',
        sortDir: 'desc',
      }),
  );

  const onExport = async () => {
    if (!workspaceId || !runId) return;
    setExporting(true);
    try {
      await businessFunctionService.amazonKw.requestExport({ workspaceId, runId });
      // poll briefly
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const r = await businessFunctionService.amazonKw.getRun({ workspaceId, runId });
        void mutate(r, { revalidate: false });
        if (r.exportInfo?.status === 'succeeded') {
          const { url, fileName } = await businessFunctionService.amazonKw.getExportUrl({
            workspaceId,
            runId,
          });
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName || 'export.xlsx';
          a.click();
          break;
        }
        if (r.exportInfo?.status === 'failed') {
          toast.error(r.exportInfo.error || 'export failed');
          break;
        }
      }
    } catch (e: any) {
      toast.error(e?.message || 'export failed');
    } finally {
      setExporting(false);
    }
  };

  const columns = useMemo(() => {
    const rows = rowsData?.rows ?? [];
    if (!rows.length) return [] as string[];
    const data = rows[0]?.data as Record<string, unknown>;
    if (!data) return [];
    const keys: string[] = [];
    const walk = (obj: Record<string, unknown>, prefix = '') => {
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v != null && typeof v === 'object' && !Array.isArray(v)) {
          walk(v as Record<string, unknown>, path);
        } else {
          keys.push(path);
        }
      }
    };
    walk(data);
    const preferred = [
      'keyword',
      'asin',
      'opsLabel',
      'relevanceLabel',
      'relevanceScore',
      'compositeScore',
      'category',
      'current.orders',
      'current.spend',
      'current.sales',
      'current.acos',
      'primarySource.campaign',
      'primarySource.adGroup',
      'executionLevel',
      'suggestion',
    ];
    return [
      ...preferred.filter((k) => keys.includes(k)),
      ...keys.filter((k) => !preferred.includes(k)),
    ].slice(0, 24);
  }, [rowsData]);

  if (!workspaceId || !runId) {
    return (
      <div className={styles.page}>
        <Text type={'secondary'}>{t('businessFunctions.amazonKw.error.workspaceOnly')}</Text>
      </div>
    );
  }

  const isRunning = run && active.includes(run.status);

  return (
    <div className={`${styles.page} ${styles.wide}`}>
      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} gap={12}>
          <WorkspaceLink to="/functions/amazon-old-product-keyword-analysis">
            <Button icon={ArrowLeftIcon} size={'small'} type={'text'} />
          </WorkspaceLink>
          <Flexbox flex={1} gap={2}>
            <Text fontSize={18} weight={600}>
              {run?.categoryName || t('businessFunctions.amazonKw.name')} · {run?.mainAsin}
            </Text>
            <Flexbox horizontal gap={8}>
              <StatusText status={run?.status || '…'} />
              <Text fontSize={12} type={'secondary'}>
                {run?.progress?.message || run?.stage}
                {run?.progress?.batchTotal
                  ? ` · batch ${run.progress.batchIndex ?? 0}/${run.progress.batchTotal}`
                  : ''}
              </Text>
            </Flexbox>
          </Flexbox>
          {isRunning && (
            <Button
              onClick={async () => {
                await businessFunctionService.amazonKw.cancel({ workspaceId, runId });
                void mutate();
              }}
            >
              {t('businessFunctions.amazonKw.cancel')}
            </Button>
          )}
          {run?.status === 'failed' && (
            <Button
              icon={RefreshCwIcon}
              onClick={async () => {
                await businessFunctionService.amazonKw.retry({ workspaceId, runId });
                void mutate();
              }}
            >
              {t('businessFunctions.amazonKw.retry')}
            </Button>
          )}
          {run?.status === 'succeeded' && (
            <Button
              icon={DownloadIcon}
              loading={exporting}
              type={'primary'}
              onClick={() => void onExport()}
            >
              {t('businessFunctions.amazonKw.export')}
            </Button>
          )}
        </Flexbox>

        {isRunning && (
          <Card title={t('businessFunctions.amazonKw.progress')}>
            <Flexbox horizontal align={'center'} gap={12}>
              <Icon spin icon={Loader2Icon} />
              <Text>
                {run?.progress?.percent ?? 0}% · {run?.progress?.message}
              </Text>
            </Flexbox>
          </Card>
        )}

        {run?.status === 'failed' && (
          <Card title="Error">
            <Text type={'danger'}>{run.error?.message || 'failed'}</Text>
          </Card>
        )}

        {run?.status === 'succeeded' && (
          <>
            <Card title={t('businessFunctions.amazonKw.views')}>
              <Flexbox gap={10}>
                <Text fontSize={12} type={'secondary'}>
                  决策
                </Text>
                <div className={styles.nav}>
                  {DECISION_VIEWS.map((id) => (
                    <Button
                      className={styles.navBtn}
                      key={id}
                      size={'small'}
                      type={viewId === id ? 'primary' : 'default'}
                      onClick={() => {
                        setViewId(id);
                        setPage(0);
                      }}
                    >
                      {VIEW_SHEET_NAMES[id]}
                    </Button>
                  ))}
                </div>
                <Text fontSize={12} type={'secondary'}>
                  分析
                </Text>
                <div className={styles.nav}>
                  {ANALYSIS_VIEWS.map((id) => (
                    <Button
                      className={styles.navBtn}
                      key={id}
                      size={'small'}
                      type={viewId === id ? 'primary' : 'default'}
                      onClick={() => {
                        setViewId(id);
                        setPage(0);
                      }}
                    >
                      {VIEW_SHEET_NAMES[id]}
                    </Button>
                  ))}
                </div>
                <Text fontSize={12} type={'secondary'}>
                  说明
                </Text>
                <div className={styles.nav}>
                  {META_VIEWS.map((id) => (
                    <Button
                      className={styles.navBtn}
                      key={id}
                      size={'small'}
                      type={viewId === id ? 'primary' : 'default'}
                      onClick={() => {
                        setViewId(id);
                        setPage(0);
                      }}
                    >
                      {VIEW_SHEET_NAMES[id]}
                    </Button>
                  ))}
                </div>
              </Flexbox>
            </Card>

            <Card
              title={VIEW_SHEET_NAMES[viewId]}
              extra={
                <Input
                  placeholder="搜索"
                  prefix={<Icon icon={SearchIcon} size={14} />}
                  style={{ width: 200 }}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                />
              }
            >
              {viewId === 'overview' && rowsData?.rows?.[0]?.data ? (
                <OverviewPanel data={rowsData.rows[0].data as any} />
              ) : (
                <>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          {columns.map((c) => (
                            <th key={c}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rowsLoading && (
                          <tr>
                            <td colSpan={columns.length || 1}>…</td>
                          </tr>
                        )}
                        {(rowsData?.rows ?? []).map((row: any) => (
                          <tr key={row.id}>
                            {columns.map((c) => (
                              <td key={c} title={String(getPath(row.data, c) ?? '')}>
                                {formatCell(getPath(row.data, c))}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Flexbox horizontal gap={8} justify={'space-between'} style={{ marginTop: 12 }}>
                    <Text fontSize={12} type={'secondary'}>
                      共 {rowsData?.total ?? 0} 行
                    </Text>
                    <Flexbox horizontal gap={8}>
                      <Button
                        disabled={page <= 0}
                        size={'small'}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                      >
                        上一页
                      </Button>
                      <Text fontSize={12}>
                        {page + 1} / {Math.max(1, Math.ceil((rowsData?.total ?? 0) / pageSize))}
                      </Text>
                      <Button
                        disabled={(page + 1) * pageSize >= (rowsData?.total ?? 0)}
                        size={'small'}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        下一页
                      </Button>
                    </Flexbox>
                  </Flexbox>
                </>
              )}
            </Card>
          </>
        )}
      </Flexbox>
    </div>
  );
});

AmazonOldProductKeywordRunPage.displayName = 'AmazonOldProductKeywordRunPage';

const OverviewPanel = memo(({ data }: { data: any }) => {
  const s = data?.summary ?? {};
  const items: [string, unknown][] = [
    ['全量自然关键词', s.naturalKeywordCount],
    ['语义高相关', s.highRelevanceCount],
    ['高胜率词', s.highWinCount],
    ['新机会词', s.newOpportunityCount],
    ['低效+否词', s.lowEfficiencyAndNegativeCount],
    ['SP订单', s.spNaturalOrders],
    ['SP ACoS', s.spAcos],
    ['SB点击订单', s.sbClickOrders],
    ['SB ACoS', s.sbAcos],
    ['ASIN否定候选', s.asinNegativeCandidateCount],
    ['受限模式', s.limitedMode ? '是' : '否'],
    ['主ASIN', data?.mainAsin],
  ];
  return (
    <Flexbox gap={12}>
      <Text weight={600}>{data?.title || '总览'}</Text>
      <div className={styles.formGrid}>
        {items.map(([k, v]) => (
          <Block key={k} padding={12} variant={'outlined'}>
            <Text fontSize={12} type={'secondary'}>
              {k}
            </Text>
            <Text fontSize={16} weight={600}>
              {v == null
                ? '—'
                : typeof v === 'number'
                  ? Number.isInteger(v)
                    ? v
                    : (v as number).toFixed(3)
                  : String(v)}
            </Text>
          </Block>
        ))}
      </div>
      {Array.isArray(s.missingSources) && s.missingSources.length > 0 && (
        <Text type={'secondary'}>缺失数据源：{s.missingSources.join(', ')}</Text>
      )}
    </Flexbox>
  );
});

const getPath = (obj: any, path: string) =>
  path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), obj);

const formatCell = (v: unknown) => {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4);
  if (typeof v === 'boolean') return v ? '是' : '否';
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};

export default AmazonOldProductKeywordPage;
