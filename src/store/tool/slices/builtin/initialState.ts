import { AgentBrowserIdentifier, builtinSkills } from '@lobechat/builtin-skills';
import { builtinTools, defaultUninstalledBuiltinTools } from '@lobechat/builtin-tools';
import { type BuiltinSkill, type LobeBuiltinTool } from '@lobechat/types';

import { shouldEnableBuiltinSkill } from '@/helpers/skillFilters';

export interface BuiltinToolState {
  builtinSkills: BuiltinSkill[];
  builtinToolLoading: Record<string, boolean>;
  builtinTools: LobeBuiltinTool[];
  /**
   * List of uninstalled builtin tool identifiers
   * Empty array means all builtin tools are enabled
   */
  uninstalledBuiltinTools: string[];
  /**
   * Loading state for fetching uninstalled builtin tools
   */
  uninstalledBuiltinToolsLoading: boolean;
}

export const initialBuiltinToolState: BuiltinToolState = {
  builtinSkills: builtinSkills.filter(
    (skill) =>
      skill.identifier === AgentBrowserIdentifier || shouldEnableBuiltinSkill(skill.identifier),
  ),
  builtinToolLoading: {},
  builtinTools,
  uninstalledBuiltinTools: defaultUninstalledBuiltinTools,
  uninstalledBuiltinToolsLoading: true,
};
