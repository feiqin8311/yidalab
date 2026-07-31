import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadDingTalkRobotFile, getDingTalkAccessToken } from './api';

describe('downloadDingTalkRobotFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves downloadUrl then fetches bytes', async () => {
    const fetch = vi
      .fn()
      // token
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'tok', expireIn: 7200 }), { status: 200 }),
      )
      // messageFiles/download
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ downloadUrl: 'https://cdn.example/f.xlsx' }), {
          status: 200,
        }),
      )
      // file bytes
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    vi.stubGlobal('fetch', fetch);

    const buf = await downloadDingTalkRobotFile({
      clientId: 'app',
      clientSecret: 'sec',
      downloadCode: 'CODE',
    });

    expect(buf.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    const downloadCall = fetch.mock.calls[1];
    expect(downloadCall[0]).toContain('messageFiles/download');
    expect(JSON.parse(downloadCall[1].body as string)).toEqual({
      downloadCode: 'CODE',
      robotCode: 'app',
    });
  });

  it('rejects when content-length exceeds max', async () => {
    // prime token cache via getDingTalkAccessToken path inside download
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'tok2', expireIn: 7200 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ downloadUrl: 'https://cdn.example/big' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(10), {
          headers: { 'content-length': String(50 * 1024 * 1024) },
          status: 200,
        }),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(
      downloadDingTalkRobotFile({
        clientId: 'app-big',
        clientSecret: 'sec',
        downloadCode: 'BIG',
        maxBytes: 1024,
      }),
    ).rejects.toThrow(/too large/);
  });
});

describe('getDingTalkAccessToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caches token', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'cached-tok', expireIn: 7200 }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetch);

    const a = await getDingTalkAccessToken('cache-app', 'sec');
    const b = await getDingTalkAccessToken('cache-app', 'sec');
    expect(a).toBe('cached-tok');
    expect(b).toBe('cached-tok');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
