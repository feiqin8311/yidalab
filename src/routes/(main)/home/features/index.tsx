'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import HomePromoBanner from '@/business/client/features/HomePromoBanner';

import AgentSelect from './AgentSelect';
import InputArea from './InputArea';
import WelcomeText from './WelcomeText';

const Home = memo(() => {
  return (
    <Flexbox gap={40}>
      <HomePromoBanner />
      <Flexbox gap={24}>
        <Flexbox gap={8}>
          <AgentSelect />
          <WelcomeText />
        </Flexbox>
        <InputArea />
      </Flexbox>
    </Flexbox>
  );
});

export default Home;
