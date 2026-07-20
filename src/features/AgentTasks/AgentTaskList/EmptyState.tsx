'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WideScreenContainer from '@/features/WideScreenContainer';

import CreateTaskInlineEntry from './CreateTaskInlineEntry';

const HERO_MAX_WIDTH = 960;

interface EmptyStateProps {
  /** When set, scopes task creation to this agent and locks the assignee. */
  agentId?: string;
}

const EmptyState = memo<EmptyStateProps>(({ agentId }) => {
  const { t } = useTranslation('chat');

  return (
    <WideScreenContainer
      gap={32}
      justify={'center'}
      minWidth={HERO_MAX_WIDTH}
      paddingBlock={24}
      wrapperStyle={{ flex: 1, overflowY: 'auto' }}
    >
      <Flexbox align={'center'} gap={8}>
        <Text as={'h1'} style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
          {t('taskList.emptyHero.greeting')}
        </Text>
        <Text fontSize={14} type={'secondary'}>
          {t('taskList.emptyHero.subtitle')}
        </Text>
      </Flexbox>

      <CreateTaskInlineEntry agentId={agentId} lockAssignee={!!agentId} variant={'hero'} />
    </WideScreenContainer>
  );
});

EmptyState.displayName = 'AgentTasksEmptyState';

export default EmptyState;
