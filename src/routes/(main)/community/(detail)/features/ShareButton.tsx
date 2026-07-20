import type { Button } from '@lobehub/ui/base-ui';
import { type ComponentProps, type ReactNode } from 'react';
import { memo } from 'react';

interface ShareButtonProps extends ComponentProps<typeof Button> {
  meta?: {
    avatar?: string | ReactNode;
    desc?: string;
    hashtags?: string[];
    tags?: ReactNode;
    title?: string;
    url: string;
  };
}

const ShareButton = memo<ShareButtonProps>(() => {
  return null;
});

export default ShareButton;
