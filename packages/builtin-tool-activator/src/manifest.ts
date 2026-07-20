import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ActivatorApiName, LobeActivatorIdentifier } from './types';

export const LobeActivatorManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Activate tools from the <available_tools> list so their full API schemas become available for use. Call this before using any tool that is not yet activated. You can activate multiple tools at once. Pass tool identifiers only (e.g. lobe-web-browsing), not function-call forms (e.g. lobe-web-browsing____search).',
      humanIntervention: 'required',
      name: ActivatorApiName.activateTools,
      parameters: {
        properties: {
          identifiers: {
            description:
              'Array of tool identifiers from <available_tools> (e.g. "lobe-web-browsing", "company.mcp.sif-mcp"). Do not use API function names with ____ separators.',
            items: {
              type: 'string',
            },
            type: 'array',
          },
          reason: {
            description:
              'A concise explanation shown to the user for why these tools need to be activated.',
            type: 'string',
          },
        },
        required: ['identifiers', 'reason'],
        type: 'object',
      },
    },
  ],
  identifier: LobeActivatorIdentifier,
  meta: {
    avatar: '🔧',
    description: 'Discover and activate tools',
    title: 'Tools Activator',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
