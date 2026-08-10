'use client';

import {
  type AnalysisSections,
  formatBidRuleLines,
  formatNegativeLines,
  resolveCpoCaps,
} from '@lobechat/utils';
import { Block, Flexbox, Input, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeftIcon, CopyIcon } from 'lucide-react';
import { memo, type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import ModelSelect from '@/features/ModelSelect';
import NavHeader from '@/features/NavHeader';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { businessFunctionService } from '@/services/businessFunction';

type AnalysisPayload = Awaited<ReturnType<typeof businessFunctionService.lingxingAdsAnalyze>>;

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

    @media (width >= 768px) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  `,
  page: css`
    overflow-y: auto;
    flex: 1;

    width: 100%;
    max-width: 920px;
    margin-block: 0;
    margin-inline: auto;
    padding-block: 16px 48px;
    padding-inline: 16px;
  `,
  section: css`
    pre {
      margin: 0;
    }
  `,
}));

const LineList = memo(({ lines }: { lines: string[] }) => (
  <Flexbox gap={6}>
    {lines.map((line) => (
      <Text key={line} type={'secondary'}>
        {line}
      </Text>
    ))}
  </Flexbox>
));

LineList.displayName = 'LineList';

const SectionCard = memo(({ title, children }: { children: ReactNode; title: string }) => (
  <Block className={styles.section} padding={16} variant={'outlined'}>
    <Flexbox gap={10}>
      <Text fontSize={15} weight={600}>
        {title}
      </Text>
      {children}
    </Flexbox>
  </Block>
));

SectionCard.displayName = 'SectionCard';

const AnalysisBody = memo(({ analysis }: { analysis: AnalysisSections }) => {
  const { t } = useTranslation('common');
  const { doubleCpo, highCpo } = resolveCpoCaps(analysis);

  return (
    <Flexbox gap={14}>
      <SectionCard title={t('businessFunctions.lingxingAds.sections.conclusion')}>
        <Text>{analysis.conclusion.detail}</Text>
      </SectionCard>

      <SectionCard title={t('businessFunctions.lingxingAds.sections.baseData')}>
        <Flexbox gap={8}>
          <Text weight={500}>{t('businessFunctions.lingxingAds.sections.compare7d')}</Text>
          <LineList lines={analysis.baseData.compare7d} />
          <Text weight={500}>{t('businessFunctions.lingxingAds.sections.compare14d')}</Text>
          <LineList lines={analysis.baseData.compare14d} />
          <Text weight={500}>{t('businessFunctions.lingxingAds.sections.compare30d')}</Text>
          <LineList lines={analysis.baseData.compare30d} />
          {analysis.baseData.bestWeek ? (
            <Text type={'secondary'}>{analysis.baseData.bestWeek}</Text>
          ) : null}
          {analysis.baseData.sku14d ? (
            <Text type={'secondary'}>{analysis.baseData.sku14d}</Text>
          ) : null}
          {analysis.baseData.sku30d ? (
            <Text type={'secondary'}>{analysis.baseData.sku30d}</Text>
          ) : null}
          <Text weight={500}>{t('businessFunctions.lingxingAds.sections.thresholds')}</Text>
          <LineList lines={analysis.baseData.thresholds} />
        </Flexbox>
      </SectionCard>

      <SectionCard title={t('businessFunctions.lingxingAds.sections.bidWithOrders')}>
        <Flexbox gap={6}>
          <Text type={'secondary'}>{analysis.bidWithOrders.current}</Text>
          <LineList lines={formatBidRuleLines(analysis.bidWithOrders.lines)} />
          {analysis.bidWithOrders.volatilityNote ? (
            <Text type={'secondary'}>- {analysis.bidWithOrders.volatilityNote}</Text>
          ) : null}
        </Flexbox>
      </SectionCard>

      <SectionCard title={t('businessFunctions.lingxingAds.sections.bidZeroOrders')}>
        <Flexbox gap={6}>
          {analysis.bidZeroOrders.note ? (
            <Text type={'secondary'}>- {analysis.bidZeroOrders.note}</Text>
          ) : null}
          <LineList lines={formatBidRuleLines(analysis.bidZeroOrders.lines)} />
        </Flexbox>
      </SectionCard>

      <SectionCard title={t('businessFunctions.lingxingAds.sections.negativeTarget')}>
        <LineList lines={formatNegativeLines(analysis.negativeTarget, doubleCpo, highCpo)} />
      </SectionCard>

      <SectionCard title={t('businessFunctions.lingxingAds.sections.negativeAd')}>
        <LineList lines={formatNegativeLines(analysis.negativeAd, doubleCpo, highCpo)} />
      </SectionCard>

      <SectionCard title={t('businessFunctions.lingxingAds.sections.negativeAdGroups')}>
        <LineList lines={formatNegativeLines(analysis.negativeAdGroups, doubleCpo, highCpo)} />
      </SectionCard>

      <SectionCard title={t('businessFunctions.lingxingAds.sections.restore')}>
        <LineList lines={analysis.restore.lines} />
      </SectionCard>
    </Flexbox>
  );
});

AnalysisBody.displayName = 'AnalysisBody';

const LingxingAdsPage = memo(() => {
  const { t } = useTranslation('common');
  const workspaceId = useActiveWorkspaceId() ?? undefined;

  const [country, setCountry] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [sku, setSku] = useState('');
  const [model, setModel] = useState<{ model: string; provider: string }>({
    model: '',
    provider: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisPayload | null>(null);

  const canSubmit = useMemo(
    () =>
      Boolean(
        workspaceId &&
        country.trim() &&
        campaignName.trim() &&
        sku.trim() &&
        model.model &&
        model.provider &&
        !loading,
      ),
    [workspaceId, country, campaignName, sku, model, loading],
  );

  const mapError = useCallback(
    (err: unknown): string => {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: string }).message)
          : err instanceof Error
            ? err.message
            : '';

      if (message.includes('LINGXING_MCP_NOT_CONFIGURED')) {
        return t('businessFunctions.lingxingAds.error.notConfigured');
      }
      if (message.includes('LINGXING_INPUT_REQUIRED') || message.includes('too_small')) {
        return t('businessFunctions.lingxingAds.error.required');
      }
      if (message.includes('NOT_A_COMPANY_MEMBER')) {
        return t('businessFunctions.lingxingAds.error.workspaceOnly');
      }
      if (message.includes('LINGXING_INCOMPLETE') || message.includes('LINGXING_INVALID')) {
        return t('businessFunctions.lingxingAds.error.invalidPayload');
      }
      if (message.includes('LINGXING_ANALYZE_FAILED') || message.includes('LINGXING_MCP_CALL')) {
        return t('businessFunctions.lingxingAds.error.callFailed');
      }
      return message || t('businessFunctions.lingxingAds.error.unknown');
    },
    [t],
  );

  const runAnalyze = useCallback(async () => {
    if (!workspaceId) {
      setError(t('businessFunctions.lingxingAds.error.workspaceOnly'));
      return;
    }
    if (!country.trim() || !campaignName.trim() || !sku.trim() || !model.model || !model.provider) {
      setError(t('businessFunctions.lingxingAds.error.required'));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await businessFunctionService.lingxingAdsAnalyze({
        campaignName: campaignName.trim(),
        country: country.trim(),
        model: { model: model.model, provider: model.provider },
        sku: sku.trim(),
        workspaceId,
      });
      setResult(data);
    } catch (err) {
      setError(mapError(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, country, campaignName, sku, model, t, mapError]);

  const copyMarkdown = useCallback(async () => {
    if (!result?.markdown) return;
    try {
      await navigator.clipboard.writeText(result.markdown);
      toast.success(t('copySuccess'));
    } catch {
      toast.error(t('copyFail'));
    }
  }, [result, t]);

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        styles={{ left: { gap: 4, paddingLeft: 4 } }}
        left={
          <Flexbox horizontal align={'center'} gap={4}>
            <WorkspaceLink to={'/functions'}>
              <Button icon={ArrowLeftIcon} size={'small'} type={'text'} />
            </WorkspaceLink>
            <Text weight={500}>{t('businessFunctions.lingxingAds.name')}</Text>
          </Flexbox>
        }
      />
      <div className={styles.page}>
        <Flexbox gap={20}>
          <Block padding={16} variant={'outlined'}>
            <Flexbox gap={14}>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <Text fontSize={13} weight={500}>
                    {t('businessFunctions.lingxingAds.form.country')}
                  </Text>
                  <Input
                    disabled={loading}
                    placeholder={t('businessFunctions.lingxingAds.form.countryPlaceholder')}
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <Text fontSize={13} weight={500}>
                    {t('businessFunctions.lingxingAds.form.campaign')}
                  </Text>
                  <Input
                    disabled={loading}
                    placeholder={t('businessFunctions.lingxingAds.form.campaignPlaceholder')}
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <Text fontSize={13} weight={500}>
                    {t('businessFunctions.lingxingAds.form.sku')}
                  </Text>
                  <Input
                    disabled={loading}
                    placeholder={t('businessFunctions.lingxingAds.form.skuPlaceholder')}
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <Text fontSize={13} weight={500}>
                    {t('businessFunctions.lingxingAds.form.model')}
                  </Text>
                  <ModelSelect
                    disabled={loading}
                    value={model.model ? model : undefined}
                    onChange={(v) => setModel({ model: v.model, provider: v.provider })}
                  />
                </label>
              </div>

              <Flexbox horizontal gap={10}>
                <Button
                  disabled={!canSubmit}
                  loading={loading}
                  type={'primary'}
                  onClick={runAnalyze}
                >
                  {t('businessFunctions.lingxingAds.form.submit')}
                </Button>
                {error ? (
                  <Button disabled={loading} type={'default'} onClick={runAnalyze}>
                    {t('businessFunctions.lingxingAds.form.retry')}
                  </Button>
                ) : null}
              </Flexbox>

              {error ? <Text style={{ color: cssVar.colorError }}>{error}</Text> : null}
            </Flexbox>
          </Block>

          {loading ? (
            <Flexbox align={'center'} gap={12} justify={'center'} padding={48}>
              <NeuralNetworkLoading size={36} />
              <Text type={'secondary'}>{t('businessFunctions.lingxingAds.loading')}</Text>
            </Flexbox>
          ) : null}

          {!loading && result?.analysis ? (
            <Flexbox gap={14}>
              <Flexbox horizontal align={'center'} justify={'space-between'}>
                <Text fontSize={16} weight={600}>
                  {t('businessFunctions.lingxingAds.results')}
                </Text>
                <Button icon={CopyIcon} size={'small'} type={'default'} onClick={copyMarkdown}>
                  {t('businessFunctions.lingxingAds.copyMarkdown')}
                </Button>
              </Flexbox>

              <AnalysisBody analysis={result.analysis} />
            </Flexbox>
          ) : null}
        </Flexbox>
      </div>
    </Flexbox>
  );
});

LingxingAdsPage.displayName = 'LingxingAdsPage';

export default LingxingAdsPage;
