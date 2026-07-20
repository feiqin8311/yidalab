import { useTranslation } from 'react-i18next';

import CompanySettings from '@/features/Company/CompanySettings';

export default function WorkspaceMembers() {
  const { t } = useTranslation('auth');

  return (
    <CompanySettings
      headerTitle={t('company.tab.members')}
      initialTab="members"
      tabs={['members', 'invitations']}
    />
  );
}
