import { DEFAULT_BOT_DEBOUNCE_MS, MAX_BOT_DEBOUNCE_MS } from '@lobechat/const';

import {
  allowFromField,
  displayToolCallsField,
  makeDmPolicyField,
  makeGroupPolicyFields,
  makeUserIdField,
  watchKeywordsField,
} from '../const';
import type { FieldSchema } from '../types';

export const schema: FieldSchema[] = [
  {
    key: 'applicationId',
    label: 'channel.dingtalk.clientId',
    description: 'channel.dingtalk.clientIdHint',
    required: true,
    type: 'string',
  },
  {
    key: 'credentials',
    label: 'channel.credentials',
    type: 'object',
    properties: [
      {
        key: 'clientSecret',
        label: 'channel.dingtalk.clientSecret',
        description: 'channel.dingtalk.clientSecretHint',
        required: true,
        type: 'password',
      },
    ],
  },
  {
    key: 'settings',
    label: 'channel.settings',
    type: 'object',
    properties: [
      makeUserIdField('dingtalk'),
      {
        key: 'concurrency',
        default: 'queue',
        description: 'channel.concurrencyHint',
        enum: ['queue', 'debounce'],
        enumDescriptions: ['channel.concurrencyQueueHint', 'channel.concurrencyDebounceHint'],
        enumLabels: ['channel.concurrencyQueue', 'channel.concurrencyDebounce'],
        label: 'channel.concurrency',
        type: 'string',
      },
      {
        key: 'debounceMs',
        default: DEFAULT_BOT_DEBOUNCE_MS,
        description: 'channel.debounceMsHint',
        label: 'channel.debounceMs',
        maximum: MAX_BOT_DEBOUNCE_MS,
        minimum: 100,
        type: 'number',
        visibleWhen: { field: 'concurrency', value: 'debounce' },
      },
      {
        key: 'showUsageStats',
        default: false,
        description: 'channel.showUsageStatsHint',
        label: 'channel.showUsageStats',
        type: 'boolean',
      },
      displayToolCallsField,
      makeDmPolicyField({ policy: 'open' }),
      ...makeGroupPolicyFields({ policy: 'open' }),
      allowFromField,
      watchKeywordsField,
    ],
  },
];
