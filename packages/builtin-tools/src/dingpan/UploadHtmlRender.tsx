'use client';

import { DingpanIdentifier } from '@lobechat/builtin-tool-dingpan';
import type { BuiltinRenderProps } from '@lobechat/types';
import { copyToClipboard, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { message } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Copy, FileCode2, Maximize2, Minimize2 } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/slices/portal/selectors';

import { parseDingpanUploadResult } from './parseResult';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
  header: css`
    padding-block: 10px;
    padding-inline: 12px;
  `,
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorPrimary};
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-weight: 500;
    color: ${cssVar.colorText};
    word-break: break-all;
  `,
}));

const UploadHtmlRender = memo<BuiltinRenderProps>(({ content, messageId, pluginState }) => {
  const { t } = useTranslation('plugin');
  const [openToolUI, closeToolUI, isOpen] = useChatStore((s) => [
    s.openToolUI,
    s.closeToolUI,
    chatPortalSelectors.isPluginUIOpen(messageId)(s),
  ]);

  const result = useMemo(
    () => parseDingpanUploadResult(content, pluginState as Record<string, unknown> | null),
    [content, pluginState],
  );

  const handleCopyLink = useCallback(async () => {
    if (!result.previewUrl) return;
    await copyToClipboard(result.previewUrl);
    message.success(t('builtins.lobe-dingpan.card.copyLinkSuccess'));
  }, [result.previewUrl, t]);

  if (!result.success && !result.previewUrl && !result.documentId) {
    // Let the default tool bubble show the raw error string.
    return null;
  }

  const title = result.name || t('builtins.lobe-dingpan.card.defaultTitle');
  const canWorkspacePreview = Boolean(result.documentId);
  const canCopyLink = Boolean(result.previewUrl);

  const handleWorkspacePreview = () => {
    if (!canWorkspacePreview) return;
    if (isOpen) {
      closeToolUI();
      return;
    }
    openToolUI(messageId, DingpanIdentifier);
  };

  return (
    <Flexbox className={styles.container}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={10}>
        <FileCode2 className={styles.icon} size={18} />
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <div className={styles.title}>{title}</div>
          <div className={styles.meta}>
            {result.success
              ? t('builtins.lobe-dingpan.card.uploaded')
              : t('builtins.lobe-dingpan.card.partial')}
          </div>
        </Flexbox>
      </Flexbox>

      <Flexbox horizontal gap={8} paddingBlock={0} paddingInline={12} style={{ paddingBottom: 12 }}>
        {canWorkspacePreview ? (
          <Button
            icon={isOpen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            size={'small'}
            onClick={handleWorkspacePreview}
          >
            {isOpen
              ? t('builtins.lobe-dingpan.card.closePreview')
              : t('builtins.lobe-dingpan.card.workspacePreview')}
          </Button>
        ) : result.success ? (
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('builtins.lobe-dingpan.card.noLocalDoc')}
          </Text>
        ) : null}
        {canCopyLink ? (
          <Button icon={<Copy size={14} />} size={'small'} onClick={handleCopyLink}>
            {t('builtins.lobe-dingpan.card.copyLink')}
          </Button>
        ) : null}
      </Flexbox>
    </Flexbox>
  );
});

UploadHtmlRender.displayName = 'DingpanUploadHtmlRender';

export default UploadHtmlRender;
