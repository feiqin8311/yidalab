'use client';

import { Center, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

// Open-source pageShare backend is a cloud stub — never call it.
const SharePagePage = memo(() => {
  const { t } = useTranslation('common');

  return (
    <Center gap={8} height={'100vh'}>
      <Text fontSize={16} weight={500}>
        {t('sharePage.unavailableTitle', { defaultValue: 'Page sharing is not available' })}
      </Text>
      <Text type={'secondary'}>
        {t('sharePage.unavailableDesc', {
          defaultValue: 'This feature is not enabled in the current deployment.',
        })}
      </Text>
    </Center>
  );
});

SharePagePage.displayName = 'SharePagePage';

export default SharePagePage;
