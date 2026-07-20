import { Block } from '@lobehub/ui';
import { memo } from 'react';

import Arguments from '../Arguments';
import { ResultBody } from './ResultBody';

interface FallbackArgumentRenderProps {
  content: string;
  requestArgs?: string;
  /**
   * When false, arguments are rendered by the parent ToolRender (white-box
   * shared header). Default true for standalone use.
   */
  showArguments?: boolean;
  toolCallId: string;
}

export const FallbackArgumentRender = memo<FallbackArgumentRenderProps>(
  ({ toolCallId, content, requestArgs, showArguments = true }) => {
    // Default render: arguments + collapsible result (summary by default).
    return (
      <Block id={toolCallId} variant={'outlined'} width={'100%'}>
        {showArguments ? <Arguments arguments={requestArgs} /> : null}
        <ResultBody content={content} />
      </Block>
    );
  },
);
