'use client';

import type { BuiltinPortalProps } from '@lobechat/types';
import { Center, Flexbox, Highlighter, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { InlineHtmlPreview } from '@/components/HtmlPreview';
import { documentService } from '@/services/document';
import { useChatStore } from '@/store/chat';
import { dbMessageSelectors } from '@/store/chat/selectors';

import { parseDingpanUploadResult } from './parseResult';
import { resolveArtifactHtml, resolveLegacyDocumentId } from './previewSource';

const styles = createStaticStyles(({ css, cssVar }) => ({
  empty: css`
    padding: 24px;
    color: ${cssVar.colorTextSecondary};
  `,
  frame: css`
    overflow: hidden;
    flex: 1;

    min-height: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};
  `,
  root: css`
    display: flex;
    flex-direction: column;

    height: 100%;
    min-height: 0;
    padding-block: 8px;
    padding-inline: 12px;
  `,
}));

type DingpanPortalArgs = {
  documentId?: string;
  html?: string;
};

const DingpanPortal = memo<BuiltinPortalProps>(({ arguments: portalArgs, messageId, state }) => {
  const { t } = useTranslation('plugin');
  const message = useChatStore(dbMessageSelectors.getDbMessageById(messageId));

  const result = useMemo(
    () =>
      parseDingpanUploadResult(
        message?.content,
        (state as Record<string, unknown> | null) ??
          (message?.pluginState as Record<string, unknown> | null),
      ),
    [message?.content, message?.pluginState, state],
  );

  const args = (portalArgs ?? {}) as DingpanPortalArgs;
  const artifactHtml = resolveArtifactHtml(args);
  const documentId = resolveLegacyDocumentId(args, result);

  // Prefer message tool-call HTML (survives resource library wipe). Fall back to
  // legacy deliverable documents for older rows that only stored documentId.
  const needsDocFetch = Boolean(documentId);
  const { data, isLoading } = useSWR(
    needsDocFetch ? ['dingpan-html-preview', documentId] : null,
    async () => {
      const doc = await documentService.getDocumentById(documentId!);
      if (!doc?.content?.trim()) throw new Error('empty document');
      return doc;
    },
    { revalidateOnFocus: false },
  );

  const html = artifactHtml || data?.content?.trim() || '';
  const hasPreviewLink = Boolean(result.previewUrl);

  const openDingpanLink = hasPreviewLink ? (
    <a href={result.previewUrl} rel="noreferrer" target="_blank">
      {t('builtins.lobe-dingpan.card.openDingpan')}
    </a>
  ) : null;

  if (!html && !needsDocFetch) {
    return (
      <Center className={styles.empty} flex={1} gap={8}>
        <Text type={'secondary'}>{t('builtins.lobe-dingpan.portal.noDocument')}</Text>
        {openDingpanLink}
      </Center>
    );
  }

  if (needsDocFetch && isLoading) {
    return (
      <Center className={styles.empty} flex={1}>
        <Text type={'secondary'}>{t('builtins.lobe-dingpan.portal.loading')}</Text>
      </Center>
    );
  }

  if (!html) {
    return (
      <Center className={styles.empty} flex={1} gap={8}>
        <Text type={'secondary'}>{t('builtins.lobe-dingpan.portal.loadFailed')}</Text>
        {openDingpanLink}
      </Center>
    );
  }

  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(html);

  return (
    <Flexbox className={styles.root} gap={8}>
      {result.previewUrl ? (
        <Text
          title={result.previewUrl}
          type={'secondary'}
          style={{
            fontSize: 12,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <a href={result.previewUrl} rel="noreferrer" target="_blank">
            {result.previewUrl}
          </a>
        </Text>
      ) : null}
      <div className={styles.frame}>
        {looksLikeHtml ? (
          <InlineHtmlPreview content={html} height={'100%'} />
        ) : (
          <Highlighter language={'html'} style={{ fontSize: 12, height: '100%', overflow: 'auto' }}>
            {html}
          </Highlighter>
        )}
      </div>
    </Flexbox>
  );
});

DingpanPortal.displayName = 'DingpanPortal';

export default DingpanPortal;
