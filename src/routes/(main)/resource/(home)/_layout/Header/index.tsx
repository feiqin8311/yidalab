'use client';

import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';

import CategoryMenu from './CategoryMenu';

const Header = memo(() => {
  const { t } = useTranslation('common');
  const activeWorkspaceId = useActiveWorkspaceId();
  const hydrateListVisibility = useResourceManagerStore((s) => s.hydrateListVisibility);

  useEffect(() => {
    hydrateListVisibility(activeWorkspaceId ?? undefined);
  }, [activeWorkspaceId, hydrateListVisibility]);

  return (
    <>
      <SideBarHeaderLayout
        breadcrumb={[
          {
            href: '/resource',
            title: t('tab.resource'),
          },
        ]}
      />
      <CategoryMenu />
    </>
  );
});

export default Header;
