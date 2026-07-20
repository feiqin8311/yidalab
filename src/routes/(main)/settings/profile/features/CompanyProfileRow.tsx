'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { useTranslation } from 'react-i18next';

import { useMyCompany } from '@/features/Company/hooks';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import ProfileRow from './ProfileRow';

const CompanyProfileRow = () => {
  const { t } = useTranslation('auth');
  const { data: company } = useMyCompany();

  return (
    <>
      <ProfileRow label={t('profile.company')}>
        {company ? (
          <Flexbox horizontal align={'center'} gap={8}>
            <Text>{company.name}</Text>
            <WorkspaceLink to={'/settings/general'}>
              <Button size={'small'} type={'text'}>
                {t('company.manage')}
              </Button>
            </WorkspaceLink>
          </Flexbox>
        ) : (
          <Flexbox horizontal align={'center'} gap={8}>
            <Text type={'secondary'}>{t('company.none')}</Text>
            <WorkspaceLink to={'/settings/general'}>
              <Button size={'small'} type={'text'}>
                {t('company.create.action')}
              </Button>
            </WorkspaceLink>
          </Flexbox>
        )}
      </ProfileRow>
      {company && (
        <>
          <Divider style={{ margin: 0 }} />
          <ProfileRow label={t('company.department')}>
            <Text>{company.departmentName ?? t('company.unassigned')}</Text>
          </ProfileRow>
          <Divider style={{ margin: 0 }} />
          <ProfileRow label={t('profile.position')}>
            <Text>{company.position || '-'}</Text>
          </ProfileRow>
        </>
      )}
    </>
  );
};

export default CompanyProfileRow;
