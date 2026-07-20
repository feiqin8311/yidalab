import { Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';

import { useDetailContext } from '../DetailProvider';
import Block from './Block';
import Prompts from './Prompts';
import Resources from './Resources';
import Tools from './Tools';
import { ModeType } from './types';

const Schema = memo(() => {
  const { t } = useTranslation('discover');
  const { promptsCount, toolsCount, resourcesCount, tools, prompts, identifier } =
    useDetailContext();
  const installedApiCount = useToolStore((s) => {
    if (!identifier) return 0;
    return pluginSelectors.getToolManifestById(identifier)(s)?.api?.length || 0;
  });
  const resolvedToolsCount = toolsCount || tools?.length || installedApiCount || 0;
  const resolvedPromptsCount = promptsCount || prompts?.length || 0;
  const [toolsActiveKey, setToolsActiveKey] = useState<string[]>([]);
  const [toolsMode, setToolsMode] = useState<ModeType>(ModeType.Docs);
  const [promptsActiveKey, setPromptsActiveKey] = useState<string[]>([]);
  const [promptsMode, setPromptsMode] = useState<ModeType>(ModeType.Docs);
  const [resourcesMode, setResourcesMode] = useState<ModeType>(ModeType.Docs);

  return (
    <Flexbox gap={64}>
      <Block
        count={resolvedToolsCount}
        desc={t('mcp.details.schema.tools.desc')}
        id={'tools'}
        mode={toolsMode}
        setMode={setToolsMode}
        title={t('mcp.details.schema.tools.title')}
      >
        <Tools activeKey={toolsActiveKey} mode={toolsMode} setActiveKey={setToolsActiveKey} />
      </Block>

      <Block
        count={resolvedPromptsCount}
        desc={t('mcp.details.schema.prompts.desc')}
        id={'prompts'}
        mode={promptsMode}
        setMode={setPromptsMode}
        title={t('mcp.details.schema.prompts.title')}
      >
        <Prompts
          activeKey={promptsActiveKey}
          mode={promptsMode}
          setActiveKey={setPromptsActiveKey}
        />
      </Block>

      <Block
        count={resourcesCount || 0}
        desc={t('mcp.details.schema.resources.desc')}
        id={'resources'}
        mode={resourcesMode}
        setMode={setResourcesMode}
        title={t('mcp.details.schema.resources.title')}
      >
        <Resources mode={resourcesMode} />
      </Block>
    </Flexbox>
  );
});

export default Schema;
