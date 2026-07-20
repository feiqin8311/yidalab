'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import CompanySettings from '@/features/Company/CompanySettings';

const DepartmentsPage = memo(() => {
  const { t } = useTranslation('auth');

  return (
    <CompanySettings
      headerTitle={t('company.organization')}
      initialTab="organization"
      tabs={['organization']}
    />
  );
});

export default DepartmentsPage;
