import { getBuiltinRender } from '@lobechat/builtin-tools/renders';
import { type ChatPluginPayload } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import Arguments from '../Arguments';
import CustomRender from './CustomRender';
import { FallbackArgumentRender } from './FallbacktArgumentRender';

interface ToolRenderProps {
  content: string;
  messageId?: string;
  plugin?: ChatPluginPayload;
  pluginState?: any;
  showCustomToolRender?: boolean;
  toolCallId: string;
}

/**
 * Expanded tool body (white-box). Layout:
 * 1. Arguments always on top when present (everyone can inspect params)
 * 2. Custom skill/tool render when available
 * 3. Otherwise fallback result with truncated preview
 *
 * Collapsed title row stays the light "brief"; expand is the audit view.
 */
const ToolRender = memo<ToolRenderProps>(
  ({ showCustomToolRender, content, messageId, plugin, pluginState, toolCallId }) => {
    const hasCustomRender = !!getBuiltinRender(plugin?.identifier, plugin?.apiName);
    const requestArgs = plugin?.arguments;
    const hasArgs = !!(requestArgs && requestArgs.trim() && requestArgs.trim() !== '{}');

    if (hasCustomRender && showCustomToolRender) {
      return (
        <Block id={toolCallId} variant={'outlined'} width={'100%'}>
          <Flexbox gap={0} width={'100%'}>
            {hasArgs ? <Arguments arguments={requestArgs} /> : null}
            <CustomRender
              content={content}
              messageId={messageId}
              plugin={plugin}
              pluginState={pluginState}
              toolCallId={toolCallId}
            />
          </Flexbox>
        </Block>
      );
    }

    return (
      <FallbackArgumentRender
        showArguments
        content={content}
        requestArgs={requestArgs}
        toolCallId={toolCallId}
      />
    );
  },
);

ToolRender.displayName = 'ToolResultRender';

export default ToolRender;
