'use client';

import { Alert, Flexbox, FormGroup, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveCompanyRecommendedExamples } from '@/const/recommendedExamples';
import { OpeningQuestionsControl } from '@/features/AgentSetting/AgentOpening/OpeningQuestions';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { companyService } from '@/services/company';

import { refreshCompany, useMyCompany } from './hooks';

/**
 * Company-wide recommended examples (Settings → 推荐示例, under Memory).
 * Admin/owner edit; every member's agent home surfaces these chips.
 */
const CompanyRecommendedExamples = () => {
  const { t } = useTranslation('auth');
  const { data: company, error, isLoading, mutate } = useMyCompany();
  const [examplesSaving, setExamplesSaving] = useState(false);
  const [recommendedExamples, setRecommendedExamples] = useState<string[]>([]);

  const canManage = company?.role === 'admin' || company?.role === 'owner';

  useEffect(() => {
    if (!company) return;
    setRecommendedExamples(
      resolveCompanyRecommendedExamples(company.settings?.recommendedExamples),
    );
  }, [company, company?.settings?.recommendedExamples]);

  if (error) {
    return (
      <>
        <SettingHeader title={t('company.recommendedExamples.title')} />
        <Alert
          action={<Button onClick={() => void mutate()}>{t('company.retry')}</Button>}
          type={'error'}
        />
      </>
    );
  }

  if (isLoading || !company) {
    return (
      <>
        <SettingHeader title={t('company.recommendedExamples.title')} />
        <Text>{t('company.loading')}</Text>
      </>
    );
  }

  return (
    <>
      <SettingHeader title={t('company.recommendedExamples.title')} />
      <FormGroup
        collapsible={false}
        desc={t('company.recommendedExamples.desc')}
        title={t('company.recommendedExamples.title')}
        variant={'filled'}
      >
        {canManage ? (
          <Flexbox gap={12}>
            <OpeningQuestionsControl
              value={recommendedExamples}
              onChange={setRecommendedExamples}
            />
            <Button
              loading={examplesSaving}
              style={{ alignSelf: 'flex-start' }}
              type={'primary'}
              onClick={async () => {
                try {
                  setExamplesSaving(true);
                  await companyService.updateSettings({
                    recommendedExamples,
                    workspaceId: company.id,
                  });
                  await refreshCompany(company.id);
                  toast.success(t('company.recommendedExamples.saved'));
                } catch (err) {
                  console.error('[company:updateRecommendedExamples]', err);
                  toast.error(t('company.recommendedExamples.saveFailed'));
                } finally {
                  setExamplesSaving(false);
                }
              }}
            >
              {t('profile.save')}
            </Button>
          </Flexbox>
        ) : (
          <Text type={'secondary'}>{t('company.recommendedExamples.memberReadonly')}</Text>
        )}
      </FormGroup>
    </>
  );
};

export default CompanyRecommendedExamples;
