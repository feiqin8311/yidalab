'use client';

import { Button, DropdownMenu, Icon, Tooltip } from '@lobehub/ui';
import { Building2, Plus, User } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMyCompany } from '@/features/Company/hooks';
import { usePermission } from '@/hooks/usePermission';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import { createCreateCredModal } from './features/CreateCredModal';
import CredsList from './features/CredsList';
import { useCredsApi } from './features/useCredsApi';

const Page = () => {
  const { t } = useTranslation('setting');
  const { allowed: canManageCredentials, reason } = usePermission('manage_provider_key');
  const { data: company } = useMyCompany();
  const canManageCompany = company?.role === 'admin' || company?.role === 'owner';
  const [refreshKey, setRefreshKey] = useState(0);
  const credsApi = useCredsApi();

  const openCreate = (scope: 'personal' | 'company') => {
    if (scope === 'company' && !canManageCompany) return;
    if (scope === 'personal' && !canManageCredentials) return;
    createCreateCredModal({
      credsApi,
      onSuccess: () => setRefreshKey((k) => k + 1),
      scope,
    });
  };

  const createMenuItems = [
    {
      disabled: !canManageCredentials,
      icon: <Icon icon={User} />,
      key: 'personal',
      label: t('creds.createPersonal'),
      onClick: () => openCreate('personal'),
    },
    ...(company
      ? [
          {
            disabled: !canManageCompany,
            icon: <Icon icon={Building2} />,
            key: 'company',
            label: t('creds.createCompany'),
            onClick: () => openCreate('company'),
          },
        ]
      : []),
  ];

  return (
    <>
      <SettingHeader
        title={t('tab.creds')}
        extra={
          <Tooltip
            title={
              !canManageCredentials && !canManageCompany
                ? reason
                : canManageCompany
                  ? undefined
                  : t('creds.createCompanyHint')
            }
          >
            {company ? (
              <DropdownMenu items={createMenuItems} placement="bottomRight">
                <Button icon={<Icon icon={Plus} />} size={'large'}>
                  {t('creds.create')}
                </Button>
              </DropdownMenu>
            ) : (
              <Button
                disabled={!canManageCredentials}
                icon={<Icon icon={Plus} />}
                size={'large'}
                onClick={() => openCreate('personal')}
              >
                {t('creds.create')}
              </Button>
            )}
          </Tooltip>
        }
      />
      <CredsList key={refreshKey} />
    </>
  );
};

Page.displayName = 'CredsSetting';

export default Page;
