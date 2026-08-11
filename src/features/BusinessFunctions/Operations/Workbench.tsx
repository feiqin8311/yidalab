'use client';

import type { OperationsFieldDef } from '@lobechat/utils';
import { Block, Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { Button, confirmModal, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowLeftIcon,
  DownloadIcon,
  Maximize2Icon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { InlineHtmlPreview } from '@/components/HtmlPreview';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import ModelSelect from '@/features/ModelSelect';
import NavHeader from '@/features/NavHeader';
import { createSkillStoreModal } from '@/features/SkillStore';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { businessFunctionService } from '@/services/businessFunction';

import { clampHistoryOffset } from './historyOffset';

const styles = createStaticStyles(({ css }) => ({
  field: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  formGrid: css`
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;

    @media (width >= 900px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  `,
  modeGrid: css`
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;

    @media (width >= 768px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  `,
  modeCard: css`
    cursor: pointer;
    transition: border-color 0.15s ease;

    &:hover {
      border-color: ${cssVar.colorPrimary};
    }
  `,
  modeCardActive: css`
    border-color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};
  `,
  page: css`
    overflow-y: auto;
    flex: 1;

    width: 100%;
    max-width: 1080px;
    margin-block: 0;
    margin-inline: auto;
    padding-block: 16px 48px;
    padding-inline: 16px;
  `,
  preview: css`
    overflow: hidden;
    min-height: 480px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
  `,
  statusDot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${cssVar.colorSuccess};
  `,
  statusDotMissing: css`
    background: ${cssVar.colorError};
  `,
  statusDotDegraded: css`
    background: ${cssVar.colorWarning};
  `,
}));

type CatalogMode = {
  description: string;
  fields: OperationsFieldDef[];
  id: string;
  name: string;
  preflight: {
    canRun: boolean;
    degraded: string[];
    missingRequired: string[];
    statuses: Array<{
      available: boolean;
      id: string;
      label: string;
      labelKey?: string;
    }>;
  };
  requiresVision?: boolean;
};

type CatalogFunction = {
  description: string;
  id: string;
  modes: CatalogMode[];
  name: string;
};

type RunItem = {
  createdAt?: string | Date;
  error?: { message?: string } | null;
  id: string;
  progress?: { message?: string; stage?: string } | null;
  resultHtml?: string | null;
  status: string;
};

const PAGE_SIZE = 20;

const emptyParams = (fields: OperationsFieldDef[]) => {
  const p: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.lockedValue !== undefined) p[f.key] = f.lockedValue;
    else if (f.defaultValue !== undefined) p[f.key] = f.defaultValue;
    else if (f.type === 'dateRange') p[f.key] = { start: '', end: '' };
    else if (f.type === 'asinList' || f.type === 'keywordList') p[f.key] = '';
    else if ((f.type === 'select' || f.type === 'marketplace') && f.options?.[0]?.value) {
      p[f.key] = f.options[0].value;
    } else p[f.key] = '';
  }
  return p;
};

const FieldInput = memo(
  ({
    disabled,
    field,
    onChange,
    optionLabel,
    placeholderText,
    value,
  }: {
    disabled?: boolean;
    field: OperationsFieldDef;
    onChange: (v: unknown) => void;
    optionLabel: (o: { label: string; labelKey?: string; value: string }) => string;
    placeholderText: (f: OperationsFieldDef) => string | undefined;
    value: unknown;
  }) => {
    if (field.lockedValue !== undefined) {
      return <Input disabled value={String(field.lockedValue)} />;
    }
    if (field.type === 'dateRange') {
      const range = (value as { end?: string; start?: string }) || {};
      return (
        <Flexbox horizontal gap={8}>
          <Input
            disabled={disabled}
            type="date"
            value={range.start || ''}
            onChange={(e) => onChange({ ...range, start: e.target.value })}
          />
          <Input
            disabled={disabled}
            type="date"
            value={range.end || ''}
            onChange={(e) => onChange({ ...range, end: e.target.value })}
          />
        </Flexbox>
      );
    }
    if (field.type === 'select' || field.type === 'marketplace') {
      return (
        <select
          disabled={disabled}
          value={String(value ?? '')}
          style={{
            height: 36,
            borderRadius: 8,
            border: `1px solid ${cssVar.colorBorder}`,
            padding: '0 10px',
            background: 'transparent',
          }}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {optionLabel(o)}
            </option>
          ))}
        </select>
      );
    }
    const ph = placeholderText(field);
    if (field.type === 'textarea' || field.type === 'asinList' || field.type === 'keywordList') {
      return (
        <TextArea
          disabled={disabled}
          placeholder={ph}
          rows={3}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    return (
      <Input
        disabled={disabled}
        placeholder={ph}
        type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  },
);

FieldInput.displayName = 'FieldInput';

const OperationsWorkbench = memo(({ functionId }: { functionId: string }) => {
  const { t } = useTranslation('common');
  const workspaceId = useActiveWorkspaceId();
  const workspaceSlug = useActiveWorkspaceSlug();
  const navigate = useNavigate();
  const { runId: routeRunId } = useParams<{ runId?: string }>();

  const [modeId, setModeId] = useState('');
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [model, setModel] = useState<{ model: string; provider: string }>({
    model: '',
    provider: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);

  const goToRun = useCallback(
    (runId?: string) => {
      const path = runId ? `/functions/${functionId}/${runId}` : `/functions/${functionId}`;
      navigate(buildWorkspaceAwarePath(path, workspaceSlug));
    },
    [functionId, navigate, workspaceSlug],
  );

  const catalogKey = workspaceId ? (['ops-catalog', workspaceId, functionId] as const) : null;
  const {
    data: catalogData,
    error: catalogError,
    isLoading: catalogLoading,
    mutate: mutateCatalog,
  } = useSWR(
    catalogKey,
    () =>
      businessFunctionService.operations.getCatalog({
        functionId,
        workspaceId: workspaceId!,
        modelSupportsTools: true,
        modelSupportsVision: true,
      }),
    { revalidateOnFocus: false },
  );

  const catalogFn = (catalogData?.functions?.[0] as CatalogFunction | undefined) ?? null;
  const mode = useMemo(
    () => catalogFn?.modes.find((m) => m.id === modeId) ?? catalogFn?.modes[0],
    [catalogFn, modeId],
  );

  // Reset form when function changes; seed first mode when catalog loads
  useEffect(() => {
    setModeId('');
    setParams({});
    setShowAdvanced(false);
    setHistoryOffset(0);
    setModel({ model: '', provider: '' });
  }, [functionId]);

  useEffect(() => {
    if (!catalogFn?.modes[0]) return;
    if (!modeId || !catalogFn.modes.some((m) => m.id === modeId)) {
      setModeId(catalogFn.modes[0].id);
      setParams(emptyParams(catalogFn.modes[0].fields));
    }
  }, [catalogFn, modeId]);

  const historyKey = workspaceId
    ? (['ops-history', workspaceId, functionId, historyOffset] as const)
    : null;
  const {
    data: historyData,
    error: historyError,
    isLoading: historyLoading,
    mutate: mutateHistory,
  } = useSWR(
    historyKey,
    () =>
      businessFunctionService.operations.listRuns({
        functionId,
        workspaceId: workspaceId!,
        limit: PAGE_SIZE,
        offset: historyOffset,
      }),
    { refreshInterval: 8000 },
  );

  const history = (historyData?.items as RunItem[]) || [];
  const historyTotal = Number(historyData?.total) || 0;

  const runKey =
    workspaceId && routeRunId ? (['ops-run', workspaceId, functionId, routeRunId] as const) : null;
  const {
    data: run,
    error: runError,
    isLoading: runLoading,
    mutate: mutateRun,
  } = useSWR(
    runKey,
    () =>
      businessFunctionService.operations.getRun({
        functionId,
        runId: routeRunId!,
        workspaceId: workspaceId!,
      }) as Promise<RunItem>,
    {
      refreshInterval: (latest) =>
        latest && ['queued', 'running'].includes(latest.status) ? 2500 : 0,
    },
  );

  // Clamp history offset when total shrinks (e.g. last item on page deleted).
  // Skip while loading/error so a key switch does not reset offset to 0 mid-flight.
  useEffect(() => {
    const ready = !historyLoading && !historyError && !!historyData;
    const next = clampHistoryOffset(
      historyOffset,
      historyData ? historyTotal : undefined,
      PAGE_SIZE,
      ready,
    );
    if (next !== historyOffset) setHistoryOffset(next);
  }, [historyTotal, historyOffset, historyLoading, historyError, historyData]);

  const selectMode = (id: string) => {
    const m = catalogFn?.modes.find((x) => x.id === id);
    if (!m) return;
    setModeId(id);
    setParams(emptyParams(m.fields));
    setShowAdvanced(false);
  };

  const canSubmit =
    Boolean(workspaceId && mode && model.model && model.provider) &&
    Boolean(mode?.preflight.canRun) &&
    !submitting;

  const onSubmit = async () => {
    if (!workspaceId || !mode) return;
    setSubmitting(true);
    try {
      const cleaned = Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, v === '' ? undefined : v]),
      );
      const created = (await businessFunctionService.operations.createRun({
        functionId,
        modeId: mode.id,
        model,
        params: cleaned,
        workspaceId,
      })) as RunItem;
      toast.success(t('businessFunctions.ops.toast.started'));
      goToRun(created.id);
      void mutateHistory();
      void mutateRun(created, { revalidate: true });
    } catch (e: any) {
      const code = e?.message || e?.data?.code;
      if (code === 'OPS_CAPABILITY_MISSING') {
        toast.error(t('businessFunctions.ops.error.capabilityMissing'));
      } else if (code === 'OPS_PARAMS_INVALID') {
        toast.error(t('businessFunctions.ops.error.paramsInvalid'));
      } else if (code === 'OPS_MODEL_NOT_FOUND' || code === 'OPS_MODEL_DISABLED') {
        toast.error(t('businessFunctions.ops.error.modelInvalid'));
      } else {
        toast.error(e?.message || t('businessFunctions.ops.error.createFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onCancel = async () => {
    if (!workspaceId || !routeRunId) return;
    try {
      const result = (await businessFunctionService.operations.cancelRun({
        runId: routeRunId,
        workspaceId,
      })) as RunItem;
      void mutateRun(result, { revalidate: true });
      void mutateHistory();
      if (result?.status === 'succeeded') {
        toast.success(t('businessFunctions.ops.toast.cancelCompleted'));
      } else if (result?.status === 'failed') {
        toast.info(t('businessFunctions.ops.toast.cancelFailedTerminal'));
      } else {
        toast.success(t('businessFunctions.ops.toast.canceled'));
      }
    } catch (e: any) {
      toast.error(e?.message || t('businessFunctions.ops.error.cancelFailed'));
    }
  };

  const onRerun = async () => {
    if (!workspaceId || !routeRunId) return;
    setSubmitting(true);
    try {
      const created = (await businessFunctionService.operations.rerun({
        runId: routeRunId,
        workspaceId,
      })) as RunItem;
      toast.success(t('businessFunctions.ops.toast.rerun'));
      goToRun(created.id);
      void mutateHistory();
    } catch (e: any) {
      toast.error(e?.message || t('businessFunctions.ops.error.rerunFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = (runId: string, status?: string) => {
    if (!workspaceId) return;
    if (status && ['queued', 'running', 'draft', 'auditing', 'exporting'].includes(status)) {
      toast.error(t('businessFunctions.ops.error.deleteActive'));
      return;
    }
    confirmModal({
      title: t('businessFunctions.ops.confirmDeleteTitle'),
      content: t('businessFunctions.ops.confirmDeleteBody'),
      onOk: async () => {
        try {
          await businessFunctionService.operations.deleteRun({ runId, workspaceId });
          toast.success(t('businessFunctions.ops.toast.deleted'));
          if (routeRunId === runId) goToRun(undefined);
          void mutateHistory();
        } catch (e: any) {
          toast.error(e?.message || t('businessFunctions.ops.error.deleteFailed'));
        }
      },
    });
  };

  const isTerminal = (s?: string) => !!s && ['succeeded', 'failed', 'canceled'].includes(s);

  const downloadHtml = () => {
    if (!run?.resultHtml) return;
    const blob = new Blob([run.resultHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ops-report-${run.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const FN_I18N: Record<string, string> = {
    'asin-promo-rhythm': 'asinPromoRhythm',
    'asin-traffic-diagnosis': 'asinTraffic',
    'brand-research': 'brandResearch',
    'category-opportunity': 'categoryOpportunity',
    'competitor-visual': 'competitorVisual',
    'listing-optimization': 'listingOptimization',
    'review-voc': 'reviewVoc',
  };
  const fnKey = (id: string) => FN_I18N[id] || id;
  const modeName = (m: CatalogMode) =>
    t(`businessFunctions.ops.modes.${m.id}.name` as any, { defaultValue: m.name });
  const modeDesc = (m: CatalogMode) =>
    t(`businessFunctions.ops.modes.${m.id}.description` as any, {
      defaultValue: m.description,
    });
  const fieldLabel = (f: OperationsFieldDef) =>
    t(`businessFunctions.ops.fields.${f.key}` as any, { defaultValue: f.label });
  const statusLabel = (s: string) =>
    t(`businessFunctions.ops.status.${s}` as any, { defaultValue: s });
  const optionLabel = (o: { label: string; labelKey?: string; value: string }) => {
    if (!o.labelKey) return o.label;
    // labelKey may be "marketplace.US" or "options.analysisScope.7d"
    return t(`businessFunctions.ops.${o.labelKey}` as any, { defaultValue: o.label });
  };
  const placeholderText = (f: OperationsFieldDef) => {
    const key = (f as any).placeholderKey as string | undefined;
    if (key) {
      return t(`businessFunctions.ops.placeholder.${key}` as any, {
        defaultValue: f.placeholder,
      });
    }
    return f.placeholder;
  };
  const capabilityLabel = (s: { label: string; labelKey?: string }) =>
    s.labelKey
      ? t(`businessFunctions.ops.capability.${s.labelKey}` as any, { defaultValue: s.label })
      : s.label;
  const progressMessage = (runItem?: RunItem | null) => {
    const stage = runItem?.progress?.stage;
    const msg = runItem?.progress?.message;
    if (stage) {
      return t(`businessFunctions.ops.progress.${stage}` as any, {
        defaultValue: msg || stage,
      });
    }
    return msg;
  };

  if (!workspaceId) {
    return (
      <Flexbox flex={1} height="100%">
        <NavHeader left={<Text weight={500}>{t('businessFunctions.ops.title')}</Text>} />
        <div className={styles.page}>
          <Text type="secondary">{t('businessFunctions.ops.error.workspaceOnly')}</Text>
        </div>
      </Flexbox>
    );
  }

  return (
    <Flexbox flex={1} height="100%">
      <NavHeader
        left={
          <Flexbox horizontal align="center" gap={8}>
            <WorkspaceLink to="/functions">
              <Button icon={ArrowLeftIcon} size="small" type="text" />
            </WorkspaceLink>
            <Text weight={500}>
              {catalogFn
                ? t(`businessFunctions.ops.${fnKey(catalogFn.id)}.name` as any, {
                    defaultValue: catalogFn.name,
                  })
                : t('businessFunctions.ops.title')}
            </Text>
          </Flexbox>
        }
      />
      <div className={styles.page}>
        <Flexbox gap={20}>
          {catalogLoading ? (
            <NeuralNetworkLoading />
          ) : catalogError ? (
            <Block padding={16} variant="outlined">
              <Flexbox gap={10}>
                <Text type="danger">{t('businessFunctions.ops.error.catalogFailed')}</Text>
                <Button type="default" onClick={() => void mutateCatalog()}>
                  {t('businessFunctions.ops.retry')}
                </Button>
              </Flexbox>
            </Block>
          ) : !catalogFn ? (
            <Text type="secondary">{t('businessFunctions.ops.error.notFound')}</Text>
          ) : (
            <>
              <Text type="secondary">
                {t(`businessFunctions.ops.${fnKey(catalogFn.id)}.description` as any, {
                  defaultValue: catalogFn.description,
                })}
              </Text>

              <Flexbox gap={10}>
                <Text fontSize={15} weight={600}>
                  {t('businessFunctions.ops.modesTitle')}
                </Text>
                <div className={styles.modeGrid}>
                  {catalogFn.modes.map((m) => (
                    <Block
                      className={`${styles.modeCard} ${m.id === mode?.id ? styles.modeCardActive : ''}`}
                      key={m.id}
                      padding={14}
                      variant="outlined"
                      onClick={() => selectMode(m.id)}
                    >
                      <Flexbox gap={4}>
                        <Text weight={600}>{modeName(m)}</Text>
                        <Text fontSize={12} type="secondary">
                          {modeDesc(m)}
                        </Text>
                      </Flexbox>
                    </Block>
                  ))}
                </div>
              </Flexbox>

              {mode ? (
                <Block padding={16} variant="outlined">
                  <Flexbox gap={14}>
                    <Text fontSize={15} weight={600}>
                      {t('businessFunctions.ops.paramsTitle')}
                    </Text>
                    <div className={styles.formGrid}>
                      {mode.fields
                        .filter((f) => !f.advanced)
                        .map((field) => (
                          <label className={styles.field} key={field.key}>
                            <Text fontSize={13} weight={500}>
                              {fieldLabel(field)}
                              {field.required ? ' *' : ''}
                            </Text>
                            <FieldInput
                              disabled={submitting}
                              field={field}
                              optionLabel={optionLabel}
                              placeholderText={placeholderText}
                              value={params[field.key]}
                              onChange={(v) => setParams((p) => ({ ...p, [field.key]: v }))}
                            />
                          </label>
                        ))}
                      <label className={styles.field}>
                        <Text fontSize={13} weight={500}>
                          {t('businessFunctions.ops.model')} *
                        </Text>
                        <ModelSelect
                          disabled={submitting}
                          value={model.model ? model : undefined}
                          requiredAbilities={
                            mode.requiresVision ? ['functionCall', 'vision'] : ['functionCall']
                          }
                          onChange={(v) => setModel({ model: v.model, provider: v.provider })}
                        />
                      </label>
                    </div>

                    {mode.fields.some((f) => f.advanced) ? (
                      <Flexbox gap={10}>
                        <Button size="small" type="text" onClick={() => setShowAdvanced((v) => !v)}>
                          {showAdvanced
                            ? t('businessFunctions.ops.hideAdvanced')
                            : t('businessFunctions.ops.showAdvanced')}
                        </Button>
                        {showAdvanced ? (
                          <div className={styles.formGrid}>
                            {mode.fields
                              .filter((f) => f.advanced)
                              .map((field) => (
                                <label className={styles.field} key={field.key}>
                                  <Text fontSize={13} weight={500}>
                                    {fieldLabel(field)}
                                  </Text>
                                  <FieldInput
                                    disabled={submitting}
                                    field={field}
                                    optionLabel={optionLabel}
                                    placeholderText={placeholderText}
                                    value={params[field.key]}
                                    onChange={(v) => setParams((p) => ({ ...p, [field.key]: v }))}
                                  />
                                </label>
                              ))}
                          </div>
                        ) : null}
                      </Flexbox>
                    ) : null}

                    <Flexbox gap={8}>
                      <Text fontSize={13} weight={500}>
                        {t('businessFunctions.ops.capabilitiesTitle')}
                      </Text>
                      <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
                        {mode.preflight.statuses.map((s) => (
                          <Flexbox horizontal align="center" gap={6} key={s.id}>
                            <span
                              className={`${styles.statusDot} ${
                                s.available
                                  ? ''
                                  : mode.preflight.missingRequired.includes(s.id)
                                    ? styles.statusDotMissing
                                    : styles.statusDotDegraded
                              }`}
                            />
                            <Text fontSize={12} type="secondary">
                              {capabilityLabel(s)}
                            </Text>
                          </Flexbox>
                        ))}
                      </Flexbox>
                      {!mode.preflight.canRun ? (
                        <Flexbox horizontal gap={8}>
                          <Text fontSize={12} type="danger">
                            {t('businessFunctions.ops.error.capabilityMissing')}
                          </Text>
                          <Button
                            size="small"
                            type="primary"
                            onClick={() => createSkillStoreModal()}
                          >
                            {t('businessFunctions.ops.openSkillStore')}
                          </Button>
                        </Flexbox>
                      ) : mode.preflight.degraded.length > 0 ? (
                        <Text fontSize={12} type="warning">
                          {t('businessFunctions.ops.degradedHint')}
                        </Text>
                      ) : null}
                    </Flexbox>

                    <Flexbox horizontal gap={10}>
                      <Button
                        disabled={!canSubmit}
                        loading={submitting}
                        type="primary"
                        onClick={() => void onSubmit()}
                      >
                        {t('businessFunctions.ops.run')}
                      </Button>
                      {run && ['queued', 'running'].includes(run.status) ? (
                        <Button type="default" onClick={() => void onCancel()}>
                          {t('businessFunctions.ops.cancel')}
                        </Button>
                      ) : null}
                      {run && ['succeeded', 'failed'].includes(run.status) ? (
                        <Button icon={RefreshCwIcon} type="default" onClick={() => void onRerun()}>
                          {t('businessFunctions.ops.rerun')}
                        </Button>
                      ) : null}
                    </Flexbox>
                  </Flexbox>
                </Block>
              ) : null}

              {routeRunId ? (
                <Block padding={16} variant="outlined">
                  <Flexbox gap={12}>
                    <Flexbox horizontal justify="space-between">
                      <Text fontSize={15} weight={600}>
                        {t('businessFunctions.ops.runStatus')}:{' '}
                        {run ? statusLabel(run.status) : '…'}
                        {progressMessage(run) ? ` · ${progressMessage(run)}` : ''}
                      </Text>
                      <Flexbox horizontal gap={8}>
                        {run?.resultHtml ? (
                          <>
                            <Button
                              icon={Maximize2Icon}
                              size="small"
                              type="text"
                              onClick={() => setFullscreen(true)}
                            />
                            <Button
                              icon={DownloadIcon}
                              size="small"
                              type="text"
                              onClick={downloadHtml}
                            />
                          </>
                        ) : null}
                        {run && isTerminal(run.status) ? (
                          <Button
                            icon={Trash2Icon}
                            size="small"
                            type="text"
                            onClick={() => onDelete(run.id, run.status)}
                          />
                        ) : null}
                      </Flexbox>
                    </Flexbox>
                    {runError ? (
                      <Flexbox gap={8}>
                        <Text type="danger">{t('businessFunctions.ops.error.runFailed')}</Text>
                        <Button size="small" onClick={() => void mutateRun()}>
                          {t('businessFunctions.ops.retry')}
                        </Button>
                      </Flexbox>
                    ) : null}
                    {runLoading && !run ? <NeuralNetworkLoading /> : null}
                    {run && ['queued', 'running'].includes(run.status) ? (
                      <NeuralNetworkLoading />
                    ) : null}
                    {run?.error?.message ? <Text type="danger">{run.error.message}</Text> : null}
                    {run?.resultHtml ? (
                      <div className={styles.preview}>
                        <InlineHtmlPreview content={run.resultHtml} height={560} />
                      </div>
                    ) : null}
                  </Flexbox>
                </Block>
              ) : null}

              <Flexbox gap={8}>
                <Text fontSize={15} weight={600}>
                  {t('businessFunctions.ops.history')}
                </Text>
                {historyError ? (
                  <Flexbox horizontal gap={8}>
                    <Text type="danger">{t('businessFunctions.ops.error.historyFailed')}</Text>
                    <Button size="small" onClick={() => void mutateHistory()}>
                      {t('businessFunctions.ops.retry')}
                    </Button>
                  </Flexbox>
                ) : null}
                {historyLoading && history.length === 0 ? (
                  <Text type="secondary">{t('businessFunctions.ops.loading')}</Text>
                ) : null}
                {history.length === 0 && !historyLoading ? (
                  <Text type="secondary">{t('businessFunctions.ops.emptyHistory')}</Text>
                ) : null}
                {history.map((h) => (
                  <Block
                    key={h.id}
                    padding={12}
                    style={{ cursor: 'pointer' }}
                    variant="outlined"
                    onClick={() => goToRun(h.id)}
                  >
                    <Flexbox horizontal justify="space-between">
                      <Text fontSize={13}>
                        {statusLabel(h.status)} · {h.id.slice(0, 10)}
                      </Text>
                      <Flexbox horizontal gap={8}>
                        <Text fontSize={12} type="secondary">
                          {h.createdAt ? new Date(h.createdAt).toLocaleString() : ''}
                        </Text>
                        {isTerminal(h.status) ? (
                          <Button
                            icon={Trash2Icon}
                            size="small"
                            type="text"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(h.id, h.status);
                            }}
                          />
                        ) : null}
                      </Flexbox>
                    </Flexbox>
                  </Block>
                ))}
                {historyTotal > 0 && (historyTotal > PAGE_SIZE || historyOffset > 0) ? (
                  <Flexbox horizontal gap={8}>
                    <Button
                      disabled={historyOffset <= 0}
                      size="small"
                      onClick={() => setHistoryOffset((o) => Math.max(0, o - PAGE_SIZE))}
                    >
                      {t('businessFunctions.ops.prevPage')}
                    </Button>
                    <Text fontSize={12} type="secondary">
                      {historyOffset + 1}–{Math.min(historyOffset + PAGE_SIZE, historyTotal)} /{' '}
                      {historyTotal}
                    </Text>
                    <Button
                      disabled={historyOffset + PAGE_SIZE >= historyTotal}
                      size="small"
                      onClick={() => setHistoryOffset((o) => o + PAGE_SIZE)}
                    >
                      {t('businessFunctions.ops.nextPage')}
                    </Button>
                  </Flexbox>
                ) : null}
              </Flexbox>
            </>
          )}
        </Flexbox>
      </div>

      {fullscreen && run?.resultHtml ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: cssVar.colorBgContainer,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Flexbox
            horizontal
            justify="space-between"
            padding={12}
            style={{ borderBottom: `1px solid ${cssVar.colorBorderSecondary}` }}
          >
            <Text weight={600}>{t('businessFunctions.ops.fullscreen')}</Text>
            <Flexbox horizontal gap={8}>
              <Button icon={DownloadIcon} size="small" onClick={downloadHtml}>
                {t('businessFunctions.ops.downloadHtml')}
              </Button>
              <Button size="small" onClick={() => setFullscreen(false)}>
                {t('businessFunctions.ops.close')}
              </Button>
            </Flexbox>
          </Flexbox>
          <div style={{ flex: 1, minHeight: 0 }}>
            <InlineHtmlPreview content={run.resultHtml} height="100%" />
          </div>
        </div>
      ) : null}
    </Flexbox>
  );
});

OperationsWorkbench.displayName = 'OperationsWorkbench';

export default OperationsWorkbench;
