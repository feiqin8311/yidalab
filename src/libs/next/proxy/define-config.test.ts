/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { config as proxyConfig } from '@/proxy';

import { defineConfig, resolvePublicOrigin } from './define-config';

vi.mock('@/auth', () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

const { middleware } = defineConfig();

const run = async (url: string) => {
  const res = await middleware(new NextRequest(url));
  return res?.headers.get('x-middleware-rewrite');
};

describe('resolvePublicOrigin', () => {
  it('prefers x-forwarded-host over bind-all nextUrl origin', () => {
    const req = new NextRequest('http://0.0.0.0:3210/', {
      headers: {
        'host': '0.0.0.0:3210',
        'x-forwarded-host': '116.205.229.31:3010',
        'x-forwarded-proto': 'http',
      },
    });
    expect(resolvePublicOrigin(req, 'http://116.205.229.31:3010')).toBe(
      'http://116.205.229.31:3010',
    );
  });

  it('falls back to APP_URL when only bind-all host is available', () => {
    const req = new NextRequest('http://0.0.0.0:3210/', {
      headers: { host: '0.0.0.0:3210' },
    });
    expect(resolvePublicOrigin(req, 'http://116.205.229.31:3010')).toBe(
      'http://116.205.229.31:3010',
    );
  });

  it('keeps LAN host for workbench / free-login', () => {
    const req = new NextRequest('http://192.168.1.8:3010/', {
      headers: { host: '192.168.1.8:3010' },
    });
    expect(resolvePublicOrigin(req, 'http://localhost:3010')).toBe('http://192.168.1.8:3010');
  });
});

describe('defineConfig locale path-traversal hardening', () => {
  it('rewrites a normal locale into /spa-auth/<locale>', async () => {
    const rewrite = await run('http://localhost:3010/signin?hl=ja-JP');
    expect(new URL(rewrite!).pathname).toBe('/spa-auth/ja-JP/signin');
  });

  it('keeps company invitation links public and routes them to the main SPA', async () => {
    const rewrite = await run('http://localhost:3010/company/invite/token-1');
    expect(new URL(rewrite!).pathname).toBe('/spa/en-US__0/company/invite/token-1');
  });

  it('falls back to en-US for a traversal locale (plain)', async () => {
    const rewrite = await run('http://localhost:3010/signin?hl=../../api/dev/x');
    const { pathname } = new URL(rewrite!);
    expect(pathname.startsWith('/spa-auth/')).toBe(true);
    expect(pathname).toBe('/spa-auth/en-US/signin');
  });

  it('falls back to en-US for a traversal locale (percent-encoded)', async () => {
    const rewrite = await run('http://localhost:3010/signin?hl=..%2F..%2Fapi%2Fdev%2Fx');
    const { pathname } = new URL(rewrite!);
    expect(pathname.startsWith('/spa-auth/')).toBe(true);
    expect(pathname).toBe('/spa-auth/en-US/signin');
  });
});

describe('company invitation proxy coverage', () => {
  it('runs the proxy for invitation deep links', () => {
    expect(proxyConfig.matcher).toEqual(expect.arrayContaining(['/company', '/company(.*)']));
  });
});
