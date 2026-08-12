'use client';

import { DingpanIdentifier } from '@lobechat/builtin-tool-dingpan';
import type { BuiltinRenderProps } from '@lobechat/types';
import { copyToClipboard, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { message } from 'antd';
import { createStaticStyles } from 'antd-style';
import {
  AlertCircle,
  Copy,
  ExternalLink,
  FileCode2,
  Maximize2,
  Minimize2,
  RotateCcw,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/slices/portal/selectors';

import { parseDingpanUploadResult } from './parseResult';
import { canWorkspacePreview, resolveArtifactHtml } from './previewSource';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
  error: css`
    color: ${cssVar.colorError};
  `,
  header: css`
    padding-block: 10px;
    padding-inline: 12px;
  `,
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorPrimary};
  `,
  iconError: css`
    flex-shrink: 0;
    color: ${cssVar.colorError};
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

const UploadHtmlRender = memo<BuiltinRenderProps>(({ args, content, messageId, pluginState }) => {
  const { t } = useTranslation('plugin');
  const [openToolUI, closeToolUI, isOpen] = useChatStore((s) => [
    s.openToolUI,
    s.closeToolUI,
    chatPortalSelectors.isPluginUIOpen(messageId)(s),
  ]);
  const [redriving, setRedriving] = useState(false);

  const result = useMemo(
    () => parseDingpanUploadResult(content, pluginState as Record<string, unknown> | null),
    [content, pluginState],
  );

  const previewArgs = args as { documentId?: string; html?: string } | undefined;
  const artifactHtml = resolveArtifactHtml(previewArgs);
  const isStreaming = content === undefined || content === null;
  const deliveryAttemptId = result.deliveryAttemptId;

  const handleCopyLink = useCallback(async () => {
    if (!result.previewUrl) return;
    await copyToClipboard(result.previewUrl);
    message.success(t('builtins.lobe-dingpan.card.copyLinkSuccess'));
  }, [result.previewUrl, t]);

  const handleOpenDingpan = useCallback(() => {
    if (!result.previewUrl) return;
    window.open(result.previewUrl, '_blank', 'noopener,noreferrer');
  }, [result.previewUrl]);

  const handleRetry = useCallback(async () => {
    if (!deliveryAttemptId || redriving) return;
    setRedriving(true);
    try {
      const row = await lambdaClient.dingpan.redriveDelivery.mutate({ id: deliveryAttemptId });
      if (row) {
        message.success(t('builtins.lobe-dingpan.card.retryQueued'));
      } else {
        message.warning(t('builtins.lobe-dingpan.card.retryUnavailable'));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      message.error(msg || t('builtins.lobe-dingpan.card.retryFailed'));
    } finally {
      setRedriving(false);
    }
  }, [deliveryAttemptId, redriving, t]);

  if (isStreaming && !result.previewUrl && !result.documentId && !artifactHtml) {
    return (
      <Flexbox className={styles.container}>
        <Flexbox horizontal align={'center'} className={styles.header} gap={10}>
          <FileCode2 className={styles.icon} size={18} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <div className={styles.title}>{t('builtins.lobe-dingpan.card.defaultTitle')}</div>
            <div className={styles.meta}>{t('builtins.lobe-dingpan.card.uploading')}</div>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  }

  if (!result.success && !result.previewUrl && !result.documentId && !artifactHtml) {
    return (
      <Flexbox className={styles.container}>
        <Flexbox horizontal align={'center'} className={styles.header} gap={10}>
          <AlertCircle className={styles.iconError} size={18} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <div className={styles.title}>{t('builtins.lobe-dingpan.card.uploadFailed')}</div>
            <div className={`${styles.meta} ${styles.error}`}>
              {result.errorText || t('builtins.lobe-dingpan.card.uploadFailedHint')}
            </div>
          </Flexbox>
        </Flexbox>
        <Flexbox
          horizontal
          gap={8}
          paddingBlock={0}
          paddingInline={12}
          style={{ paddingBottom: 12 }}
        >
          {deliveryAttemptId ? (
            <Button
              disabled={redriving}
              icon={<RotateCcw size={14} />}
              loading={redriving}
              size={'small'}
              onClick={handleRetry}
            >
              {t('builtins.lobe-dingpan.card.retry')}
            </Button>
          ) : (
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('builtins.lobe-dingpan.card.retryHint')}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
    );
  }

  const title = result.name || t('builtins.lobe-dingpan.card.defaultTitle');
  const workspacePreview = canWorkspacePreview(previewArgs, result);
  const canOpenLink = Boolean(result.previewUrl);

  const handleWorkspacePreview = () => {
    if (!workspacePreview) return;
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
        {canOpenLink ? (
          <Button
            icon={<ExternalLink size={14} />}
            size={'small'}
            type={'primary'}
            onClick={handleOpenDingpan}
          >
            {t('builtins.lobe-dingpan.card.openDingpan')}
          </Button>
        ) : null}
        {workspacePreview ? (
          <Button
            icon={isOpen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            size={'small'}
            onClick={handleWorkspacePreview}
          >
            {isOpen
              ? t('builtins.lobe-dingpan.card.closePreview')
              : t('builtins.lobe-dingpan.card.workspacePreview')}
          </Button>
        ) : result.success && !canOpenLink ? (
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('builtins.lobe-dingpan.card.noLocalDoc')}
          </Text>
        ) : null}
        {canOpenLink ? (
          <Button icon={<Copy size={14} />} size={'small'} onClick={handleCopyLink}>
            {t('builtins.lobe-dingpan.card.copyLink')}
          </Button>
        ) : null}
        {!result.success && deliveryAttemptId ? (
          <Button
            disabled={redriving}
            icon={<RotateCcw size={14} />}
            loading={redriving}
            size={'small'}
            onClick={handleRetry}
          >
            {t('builtins.lobe-dingpan.card.retry')}
          </Button>
        ) : null}
      </Flexbox>
    </Flexbox>
  );
});

UploadHtmlRender.displayName = 'DingpanUploadHtmlRender';

export default UploadHtmlRender;
