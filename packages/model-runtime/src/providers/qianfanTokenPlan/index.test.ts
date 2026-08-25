// @vitest-environment node
import { ModelProvider } from 'model-bank';

import { testProvider } from '../../providerTestUtils';
import { LobeQianfanTokenPlanAI } from './index';

const provider = ModelProvider.QianfanTokenPlan;
const defaultBaseURL = 'https://qianfan.baidubce.com/v2/tokenplan/personal';

testProvider({
  Runtime: LobeQianfanTokenPlanAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_QIANFAN_TOKEN_PLAN_CHAT_COMPLETION',
  chatModel: 'qianfan-code-latest',
  test: {
    skipAPICall: true,
  },
});
