'use client';

import { Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useNavigate } from 'react-router';

import { ProductLogo } from '@/components/Branding';
import UserAvatar from '@/features/User/UserAvatar';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

import { styles } from './SessionHeader/style';

/**
 * Temporary product hold: agent creation is disabled for YidaLab (same as desktop
 * CreateAgentButton). Mobile used to call createSession() here, which created a
 * workspace-public empty-title agent visible to all company members.
 */
const Header = memo(() => {
  const navigate = useNavigate();

  return (
    <ChatHeader
      style={mobileHeaderSticky}
      left={
        <Flexbox horizontal align={'center'} className={styles.leftContainer} gap={8}>
          <UserAvatar size={32} onClick={() => navigate('/me')} />
          <ProductLogo type={'text'} />
        </Flexbox>
      }
    />
  );
});

export default Header;
