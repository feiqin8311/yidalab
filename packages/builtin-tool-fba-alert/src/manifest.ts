import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { FbaAlertApiName, FbaAlertIdentifier } from './types';

export const FbaAlertManifest: BuiltinToolManifest = {
  api: [
    {
      // FBA jobs can take several minutes (Lingxing fetch + Excel + DingTalk).
      defaultTimeoutMs: 600_000,
      description:
        'Run company inventory alert (LIBRATON→all, EZARC→ezarc, YPLUS→yplus). Default upload_only: upload Excel to 钉盘 and return preview_url (no robot notify). Pass scope only; never pass user ids. No site menu.',
      name: FbaAlertApiName.runFbaAlert,
      parameters: {
        additionalProperties: false,
        properties: {
          mode: {
            description:
              'upload_only (default): dingpan upload + preview_url, no robot message. dry_run: generate report only. self: also DingTalk-notify resolved user (rare).',
            enum: ['upload_only', 'dry_run', 'self'],
            type: 'string',
          },
          scope: {
            description:
              'Alert scope: all | us | ca | jp | eu | ezarc | yplus | ezarc-test | yplus-test',
            enum: ['all', 'us', 'ca', 'jp', 'eu', 'ezarc', 'yplus', 'ezarc-test', 'yplus-test'],
            type: 'string',
          },
        },
        required: ['scope'],
        type: 'object',
      },
    },
  ],
  identifier: FbaAlertIdentifier,
  meta: {
    avatar: '📦',
    description: 'Company FBA inventory alert via dingtalk-fba-bot HTTP API',
    title: 'FBA Alert',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
