import type { PlatformDefinition } from '../types';
import { DingTalkClientFactory } from './client';
import { schema } from './schema';

export const dingtalk: PlatformDefinition = {
  clientFactory: new DingTalkClientFactory(),
  connectionMode: 'websocket',
  description: 'Connect a DingTalk enterprise internal bot through Stream mode',
  documentation: {
    portalUrl: 'https://open.dingtalk.com/',
    setupGuideUrl: 'https://open.dingtalk.com/document/orgapp/overview-of-stream-mode',
  },
  id: 'dingtalk',
  name: 'DingTalk',
  schema,
  supportsMarkdown: true,
  supportsMessageEdit: false,
};
