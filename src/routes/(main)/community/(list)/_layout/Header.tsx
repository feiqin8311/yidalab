'use client';

import { Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { UploadIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { useMyCompany } from '@/features/Company/hooks';
import { CustomConnectorModal } from '@/features/Connectors';
import NavHeader from '@/features/NavHeader';
import { openPublishMarketSkillModal } from '@/features/SkillStore/SkillList/UploadSkillModal';
import { mutate } from '@/libs/swr';
import StoreSearchBar from '@/routes/(main)/community/features/Search';

import SortButton from '../features/SortButton';
import { styles } from './Header/style';

const Header = memo(() => {
  const location = useLocation();
  const { t } = useTranslation('setting');
  const { data: company } = useMyCompany();
  const isCommunityHome =
    location.pathname.endsWith('/community') || location.pathname.endsWith('/community/home');
  const isSkillMarket = location.pathname.endsWith('/community/skill');
  const isMcpMarket = location.pathname.endsWith('/community/mcp');
  const canPublish = company?.role === 'admin' || company?.role === 'owner';
  const [mcpModalOpen, setMcpModalOpen] = useState(false);

  const refreshMarketSkills = () =>
    mutate(
      (key) =>
        Array.isArray(key) &&
        (key[0] === 'discover:skillCategories' ||
          key[0] === 'discover:skillList' ||
          key[0] === 'discover:skillStoreMarketSkills'),
    );

  const cssVariables: Record<string, string> = {
    '--header-border-color': cssVar.colorBorderSecondary,
  };

  return (
    <>
      <CustomConnectorModal open={mcpModalOpen} onClose={() => setMcpModalOpen(false)} />
      <NavHeader
        className={styles.headerContainer}
        left={<StoreSearchBar />}
        style={cssVariables}
        right={
          !isCommunityHome && (
            <>
              {isSkillMarket && canPublish && (
                <Button
                  icon={<Icon icon={UploadIcon} />}
                  onClick={() => openPublishMarketSkillModal({ onSuccess: refreshMarketSkills })}
                >
                  {t('marketSkillModal.publish')}
                </Button>
              )}
              {isMcpMarket && canPublish && (
                <Button icon={<Icon icon={UploadIcon} />} onClick={() => setMcpModalOpen(true)}>
                  {t('marketMcp.publish')}
                </Button>
              )}
              <SortButton />
            </>
          )
        }
        styles={{
          left: { flex: 1 },
        }}
      />
    </>
  );
});

export default Header;
