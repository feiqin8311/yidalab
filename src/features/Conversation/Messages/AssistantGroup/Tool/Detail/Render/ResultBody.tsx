'use client';

import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Soft cap for default white-box view — full text is one click away. */
const DEFAULT_PREVIEW_CHARS = 2000;

interface ResultBodyProps {
  content: string;
  /** Max characters before collapse. 0 = never truncate. */
  previewChars?: number;
}

/**
 * Shared tool-result body for the expanded tool card.
 * Default is a short preview (light UX); expand shows full response (white-box).
 */
export const ResultBody = memo<ResultBodyProps>(
  ({ content, previewChars = DEFAULT_PREVIEW_CHARS }) => {
    const { t } = useTranslation('plugin');
    const [expanded, setExpanded] = useState(false);

    const { data, language, needsTruncate } = useMemo(() => {
      try {
        const parsed = JSON.parse(content || '');
        if (typeof parsed === 'string') {
          return {
            data: parsed,
            language: 'plaintext' as const,
            needsTruncate: previewChars > 0 && parsed.length > previewChars,
          };
        }
        const pretty = JSON.stringify(parsed, null, 2);
        return {
          data: pretty,
          language: 'json' as const,
          needsTruncate: previewChars > 0 && pretty.length > previewChars,
        };
      } catch {
        const raw = content || '';
        return {
          data: raw,
          language: 'plaintext' as const,
          needsTruncate: previewChars > 0 && raw.length > previewChars,
        };
      }
    }, [content, previewChars]);

    if (!content) return null;

    const display = needsTruncate && !expanded ? `${data.slice(0, previewChars)}\n…` : data;

    return (
      <>
        <Divider style={{ marginBlock: 0 }} />
        <Flexbox
          horizontal
          align={'center'}
          justify={'space-between'}
          paddingBlock={'8px 0'}
          paddingInline={16}
        >
          <Text type={'secondary'}>{t('debug.response')}</Text>
          {needsTruncate ? (
            <Button size={'small'} variant={'text'} onClick={() => setExpanded((v) => !v)}>
              {expanded ? t('audit.collapse') : t('audit.expand')}
            </Button>
          ) : null}
        </Flexbox>
        <Highlighter
          language={language}
          variant={'filled'}
          style={{
            background: 'transparent',
            borderRadius: 0,
            maxHeight: expanded ? 480 : 240,
            overflow: 'auto',
          }}
        >
          {display}
        </Highlighter>
      </>
    );
  },
);

ResultBody.displayName = 'ToolResultBody';
