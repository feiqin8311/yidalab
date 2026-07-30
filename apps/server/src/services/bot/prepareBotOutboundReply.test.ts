import { describe, expect, it } from 'vitest';

import { compactBotRelayText } from './prepareBotOutboundReply';

describe('compactBotRelayText', () => {
  const url =
    'https://qr.dingtalk.com/page/yunpan?route=previewDentry&spaceId=1&fileId=2&type=file';

  it('keeps short text', () => {
    expect(compactBotRelayText('旺季在8月')).toBe('旺季在8月');
  });

  it('unwraps markdown links', () => {
    expect(compactBotRelayText(`[打开](${url})`)).toContain(url);
    expect(compactBotRelayText(`[打开](${url})`)).not.toContain('](');
  });

  it('strips angle-bracket autolinks around dingpan urls', () => {
    const out = compactBotRelayText(`钉盘报告：\n<${url}>`);
    expect(out).toContain(url);
    expect(out).not.toContain(`<${url}>`);
    expect(out).not.toMatch(/<https?:/);
  });

  it('puts dingpan url after clipped conclusions', () => {
    const long = `${'结论要点。'.repeat(200)}\n${url}\n更多尾巴`;
    const out = compactBotRelayText(long, 200);
    expect(out).toContain(url);
    expect(out.length).toBeLessThan(long.length);
    expect(out.indexOf('结论')).toBeLessThan(out.indexOf(url));
  });
});
