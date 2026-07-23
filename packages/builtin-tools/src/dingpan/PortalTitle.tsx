'use client';

import type { BuiltinPortalTitleProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { dbMessageSelectors } from '@/store/chat/selectors';

import { parseDingpanUploadResult } from './parseResult';

const DingpanPortalTitle = memo<BuiltinPortalTitleProps>(({ messageId }) => {
  const { t } = useTranslation('plugin');
  const message = useChatStore(dbMessageSelectors.getDbMessageById(messageId));

  const title = useMemo(() => {
    const result = parseDingpanUploadResult(
      message?.content,
      message?.pluginState as Record<string, unknown> | null,
    );
    return result.name || t('builtins.lobe-dingpan.portal.title');
  }, [message?.content, message?.pluginState, t]);

  return (
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      <Text ellipsis style={{ fontSize: 15, fontWeight: 500 }}>
        {title}
      </Text>
    </Flexbox>
  );
});

DingpanPortalTitle.displayName = 'DingpanPortalTitle';

export default DingpanPortalTitle;
