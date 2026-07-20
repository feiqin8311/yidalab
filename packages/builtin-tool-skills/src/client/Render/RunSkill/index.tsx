'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Markdown, ScrollShadow } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ActivateSkillParams, ActivateSkillState } from '../../../types';

/** Default preview length for skill body — full text on expand (white-box). */
const SKILL_BODY_PREVIEW_CHARS = 2000;

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    width: 100%;

    /* Parent ToolRender already outlines the card; avoid double border. */
  `,
  content: css`
    padding-block: 8px;
    padding-inline: 16px;
    font-size: 14px;
  `,
  description: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  footer: css`
    padding-block: 4px 8px;
    padding-inline: 12px;
  `,
  header: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  name: css`
    font-weight: 500;
  `,
}));

const RunSkill = memo<BuiltinRenderProps<ActivateSkillParams, ActivateSkillState>>(
  ({ content, pluginState }) => {
    const { t } = useTranslation('plugin');
    const { description, hideContent, name, title } = pluginState || {};
    const displayName = title || name;
    const [bodyExpanded, setBodyExpanded] = useState(false);

    // Hard gate: market skills with hideContent never show SKILL.md body in UI.
    const body = hideContent ? null : content;
    const needsTruncate = useMemo(() => !!body && body.length > SKILL_BODY_PREVIEW_CHARS, [body]);
    const displayBody =
      body && needsTruncate && !bodyExpanded
        ? `${body.slice(0, SKILL_BODY_PREVIEW_CHARS)}\n\n…`
        : body;

    if (!displayName && !body && !hideContent) return null;

    return (
      <Flexbox className={styles.container}>
        <Flexbox className={styles.header} gap={4}>
          {displayName ? <span className={styles.name}>{displayName}</span> : null}
          {description ? <span className={styles.description}>{description}</span> : null}
          {hideContent ? (
            <span className={styles.description}>{t('audit.skillBodyHidden')}</span>
          ) : null}
        </Flexbox>
        {displayBody ? (
          <>
            <ScrollShadow
              className={styles.content}
              offset={12}
              size={12}
              style={{ maxHeight: bodyExpanded ? 480 : 240 }}
            >
              <Markdown style={{ overflow: 'unset' }} variant={'chat'}>
                {displayBody}
              </Markdown>
            </ScrollShadow>
            {needsTruncate ? (
              <div className={styles.footer}>
                <Button size={'small'} variant={'text'} onClick={() => setBodyExpanded((v) => !v)}>
                  {bodyExpanded ? t('audit.collapse') : t('audit.expand')}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </Flexbox>
    );
  },
);

export default RunSkill;
