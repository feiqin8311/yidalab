import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  downloadDingTalkRobotFile,
  getDingTalkAccessToken,
  readResponseBodyWithLimit,
} from './api';

describe('downloadDingTalkRobotFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves downloadUrl then fetches bytes with required robotCode', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'tok', expireIn: 7200 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ downloadUrl: 'https://cdn.example/f.xlsx' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    vi.stubGlobal('fetch', fetch);

    const buf = await downloadDingTalkRobotFile({
      clientId: 'app',
      clientSecret: 'sec',
      downloadCode: 'CODE',
      robotCode: 'robot-from-callback',
    });

    expect(buf.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    const downloadCall = fetch.mock.calls[1];
    expect(downloadCall[0]).toContain('messageFiles/download');
    expect(JSON.parse(downloadCall[1].body as string)).toEqual({
      downloadCode: 'CODE',
      robotCode: 'robot-from-callback',
    });
  });

  it('rejects when content-length exceeds max', async () => {
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
        robotCode: 'robot-big',
      }),
    ).rejects.toThrow(/too large/);
  });

  it('rejects stream without content-length when body exceeds max', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'tok3', expireIn: 7200 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ downloadUrl: 'https://cdn.example/stream' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(5000), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      downloadDingTalkRobotFile({
        clientId: 'app-stream',
        clientSecret: 'sec',
        downloadCode: 'STREAM',
        maxBytes: 100,
        robotCode: 'robot-stream',
      }),
    ).rejects.toThrow(/too large/);
  });
});

describe('readResponseBodyWithLimit', () => {
  it('streams and stops when over max without content-length', async () => {
    const body = new Uint8Array(200);
    body.fill(7);
    const response = new Response(body, { status: 200 });
    await expect(readResponseBodyWithLimit(response, 50)).rejects.toThrow(/streamed/);
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
