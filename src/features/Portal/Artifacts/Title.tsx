import { ArtifactType } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { ConfigProvider } from 'antd';
import { cx } from 'antd-style';
import { CodeIcon, EyeIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { ArtifactDisplayMode } from '@/store/chat/slices/portal/initialState';
import { oneLineEllipsis } from '@/styles';

const Title = () => {
  const { t } = useTranslation('portal');

  const [displayMode, artifactType, artifactTitle, isArtifactTagClosed, closeArtifact] =
    useChatStore((s) => {
      const messageId = chatPortalSelectors.artifactMessageId(s) || '';
      const identifier = chatPortalSelectors.artifactIdentifier(s);

      return [
        s.portalArtifactDisplayMode,
        chatPortalSelectors.artifactType(s),
        chatPortalSelectors.artifactTitle(s),
        chatPortalSelectors.isArtifactTagClosed(messageId, identifier)(s),
        s.closeArtifact,
      ];
    });

  // show switch only when artifact is closed and the type is not code
  const showSwitch = isArtifactTagClosed && artifactType !== ArtifactType.Code;

  return (
    <Flexbox horizontal align={'center'} flex={1} gap={12} justify={'space-between'} width={'100%'}>
      <Flexbox horizontal align={'center'} gap={4} style={{ flex: 1, minWidth: 0 }}>
        <Text className={cx(oneLineEllipsis)} type={'secondary'}>
          {artifactTitle}
        </Text>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={8}>
        <ConfigProvider
          theme={{
            token: {
              borderRadiusSM: 16,
              borderRadiusXS: 16,
              fontSize: 12,
            },
          }}
        >
          {showSwitch && (
            <Tabs
              activeKey={displayMode}
              size={'small'}
              items={[
                {
                  icon: <Icon icon={EyeIcon} />,
                  key: ArtifactDisplayMode.Preview,
                  label: t('artifacts.display.preview'),
                },
                {
                  icon: <Icon icon={CodeIcon} />,
                  key: ArtifactDisplayMode.Code,
                  label: t('artifacts.display.code'),
                },
              ]}
              onChange={(key) => {
                useChatStore.setState({ portalArtifactDisplayMode: key as ArtifactDisplayMode });
              }}
            />
          )}
        </ConfigProvider>
        <ActionIcon
          icon={XIcon}
          size={'small'}
          title={t('artifacts.close', { defaultValue: 'Close' })}
          onClick={() => closeArtifact()}
        />
      </Flexbox>
    </Flexbox>
  );
};

export default Title;
