'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC, type PropsWithChildren } from 'react';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';

const Container: FC<PropsWithChildren> = ({ children }) => {
  return (
    <Flexbox flex={1} height={'100%'} style={{ minWidth: 0, overflow: 'hidden' }}>
      <NavHeader />
      <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
        <SettingContainer maxWidth={1024} padding={24}>
          {children}
        </SettingContainer>
      </Flexbox>
    </Flexbox>
  );
};
export default Container;
