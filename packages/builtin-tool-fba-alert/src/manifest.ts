import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { FbaAlertApiName, FbaAlertIdentifier } from './types';

export const FbaAlertManifest: BuiltinToolManifest = {
  api: [
    {
      // FBA jobs can take several minutes (Lingxing fetch + Excel + DingTalk).
      defaultTimeoutMs: 600_000,
      description:
        'Run company inventory alert (LIBRATON→all, EZARC→ezarc, YPLUS→yplus). Server injects current user DingTalk id; only that person is notified. Pass scope only; never pass user ids. No site menu.',
      name: FbaAlertApiName.runFbaAlert,
      parameters: {
        additionalProperties: false,
        properties: {
          mode: {
            description:
              'self (default): notify only the resolved current user. dry_run: generate report, no DingTalk send. upload_only: dingpan upload without robot messages.',
            enum: ['self', 'dry_run', 'upload_only'],
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
