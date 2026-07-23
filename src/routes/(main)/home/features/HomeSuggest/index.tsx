'use client';

import { ActionIcon, Block, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Lightbulb, RefreshCw } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';

import { type HomeSuggestItem, useHomeSuggestItems } from './useHomeSuggestItems';

const SuggestItem = memo<{ disabled?: boolean; item: HomeSuggestItem }>(({ item, disabled }) => {
  const mainInputEditor = useChatStore((s) => s.mainInputEditor);

  const handleClick = useCallback(() => {
    if (disabled) return;
    mainInputEditor?.instance?.setDocument('markdown', item.prompt);
    mainInputEditor?.focus();
  }, [disabled, item.prompt, mainInputEditor]);

  return (
    <Block
      clickable={!disabled}
      variant={'outlined'}
      style={{
        borderRadius: cssVar.borderRadiusLG,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.65 : undefined,
      }}
      onClick={handleClick}
    >
      <Flexbox gap={4} paddingBlock={12} paddingInline={14}>
        <Text ellipsis fontSize={14} style={{ fontWeight: 500 }}>
          {item.title}
        </Text>
        {item.title !== item.description && (
          <Text color={cssVar.colorTextTertiary} ellipsis={{ rows: 2 }} fontSize={12}>
            {item.description}
          </Text>
        )}
      </Flexbox>
    </Block>
  );
});

interface HomeSuggestProps {
  /** Scope chips to this agent (agent conversation welcome). Defaults to home selector. */
  agentId?: string;
}

const HomeSuggest = memo<HomeSuggestProps>(({ agentId }) => {
  const { t } = useTranslation('common');
  const { t: tHome } = useTranslation('home');
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canCreateContent } = usePermission('create_content');
  const { empty, items, loading, refresh, refreshable } = useHomeSuggestItems({ agentId });
  const disabled = !canCreateContent;

  if (loading) {
    return (
      <Flexbox gap={12} width={'100%'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Lightbulb color={cssVar.colorTextDescription} size={18} />
          <Text color={cssVar.colorTextSecondary}>{t('home.suggestQuestions')}</Text>
        </Flexbox>
        <Flexbox
          gap={12}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <Block
              key={i}
              style={{ borderRadius: cssVar.borderRadiusLG, paddingBlock: 12, paddingInline: 14 }}
              variant={'outlined'}
            >
              <Skeleton active paragraph={{ rows: 2, width: ['70%', '100%'] }} title={false} />
            </Block>
          ))}
        </Flexbox>
      </Flexbox>
    );
  }

  if (empty) {
    return (
      <Flexbox gap={8} width={'100%'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Lightbulb color={cssVar.colorTextDescription} size={18} />
          <Text color={cssVar.colorTextSecondary}>{t('home.suggestQuestions')}</Text>
        </Flexbox>
        <Text color={cssVar.colorTextTertiary} fontSize={12}>
          {tHome('suggest.empty')}{' '}
          <Text
            as={'span'}
            color={cssVar.colorLink}
            fontSize={12}
            style={{ cursor: 'pointer' }}
            onClick={() => navigate('/settings/skill')}
          >
            {tHome('suggest.emptyAction')}
          </Text>
        </Text>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={12} width={'100%'}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Lightbulb color={cssVar.colorTextDescription} size={18} />
          <Text color={cssVar.colorTextSecondary}>{t('home.suggestQuestions')}</Text>
        </Flexbox>
        {refreshable && (
          <Flexbox
            horizontal
            align={'center'}
            gap={4}
            style={{
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.65 : undefined,
            }}
            onClick={() => {
              if (disabled) return;
              refresh();
            }}
          >
            <ActionIcon disabled={disabled} icon={RefreshCw} size={'small'} />
            <Text color={cssVar.colorTextSecondary} fontSize={12}>
              {t('switch')}
            </Text>
          </Flexbox>
        )}
      </Flexbox>

      <Flexbox
        gap={12}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
      >
        {items.map((item) => (
          <SuggestItem disabled={disabled} item={item} key={item.id} />
        ))}
      </Flexbox>
    </Flexbox>
  );
});

export default HomeSuggest;
