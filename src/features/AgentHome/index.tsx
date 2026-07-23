'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import ToolAuthAlert from '@/routes/(main)/agent/features/Conversation/AgentWelcome/ToolAuthAlert';
import HomeSuggest from '@/routes/(main)/home/features/HomeSuggest';

import AgentInfo from './AgentInfo';
import { useWelcomeExtra } from './WelcomeExtraContext';

/**
 * Agent conversation welcome.
 * Recommended examples come from HomeSuggest:
 * - agent openingQuestions (Settings → Opening) when configured — fill input, do not auto-send
 * - otherwise curated ops / tool fallback chips
 */
const AgentHome = memo(() => {
  // Same scope rule as AgentInfo: conversation agent, not shared activeAgentId.
  const agentId = useConversationStore(contextSelectors.agentId) || undefined;
  const extra = useWelcomeExtra();

  return (
    <>
      <Flexbox flex={1} />
      <Flexbox gap={32} style={{ paddingBottom: 'max(4vh, 16px)' }} width={'100%'}>
        <AgentInfo />
        {extra}
        <HomeSuggest agentId={agentId} />
        <ToolAuthAlert />
      </Flexbox>
    </>
  );
});

export default AgentHome;
