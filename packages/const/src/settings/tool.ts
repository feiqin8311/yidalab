import type { UserToolConfig } from '@lobechat/types';

/** YidaLab default: auto-approve tool calls in conversation. */
export const DEFAULT_TOOL_CONFIG: UserToolConfig = {
  humanIntervention: {
    approvalMode: 'auto-run',
  },
};
