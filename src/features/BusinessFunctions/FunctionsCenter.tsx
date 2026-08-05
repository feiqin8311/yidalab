'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LayoutGridIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { getEnabledBusinessFunctions } from './registry';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    cursor: pointer;
    height: 100%;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;

    &:hover {
      border-color: ${cssVar.colorBorderSecondary};
      box-shadow: 0 4px 16px ${cssVar.colorFillTertiary};
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;

    @media (width >= 768px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @media (width >= 1100px) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  `,
  iconWrap: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 44px;
    height: 44px;
    border-radius: 12px;

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  link: css`
    color: inherit;
    text-decoration: none;
  `,
  page: css`
    width: 100%;
    max-width: 1080px;
    margin-block: 0;
    margin-inline: auto;
    padding-block: 24px 48px;
    padding-inline: 16px;
  `,
}));

const FunctionsCenter = memo(() => {
  const { t } = useTranslation('common');
  const items = getEnabledBusinessFunctions();

  return (
    <div className={styles.page}>
      <Flexbox gap={24}>
        <Flexbox horizontal align={'flex-start'} gap={8}>
          <div className={styles.iconWrap}>
            <Icon icon={LayoutGridIcon} size={22} />
          </div>
          <Flexbox gap={4}>
            <Text as={'h1'} fontSize={22} weight={600}>
              {t('businessFunctions.centerTitle')}
            </Text>
            <Text type={'secondary'}>{t('businessFunctions.centerDesc')}</Text>
          </Flexbox>
        </Flexbox>

        <div className={styles.grid}>
          {items.map((item) => (
            <WorkspaceLink className={styles.link} key={item.id} to={item.path}>
              <Block className={styles.card} padding={20} variant={'outlined'}>
                <Flexbox horizontal gap={14}>
                  <div className={styles.iconWrap}>
                    <Icon icon={item.icon} size={22} />
                  </div>
                  <Flexbox flex={1} gap={6}>
                    <Text fontSize={16} weight={600}>
                      {t(item.nameKey)}
                    </Text>
                    <Text fontSize={13} type={'secondary'}>
                      {t(item.descriptionKey)}
                    </Text>
                  </Flexbox>
                </Flexbox>
              </Block>
            </WorkspaceLink>
          ))}
        </div>
      </Flexbox>
    </div>
  );
});

FunctionsCenter.displayName = 'FunctionsCenter';

export default FunctionsCenter;
