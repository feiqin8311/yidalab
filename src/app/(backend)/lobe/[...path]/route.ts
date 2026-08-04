import http from 'node:http';
import https from 'node:https';

import { type NextRequest, NextResponse } from 'next/server';

/**
 * Same-origin S3 path-style proxy for local/dev.
 *
 * Production nginx routes `/lobe/*` → rustfs so the browser uploads to the app
 * host (no cross-origin). Locally we sign with `S3_ENDPOINT=http://localhost:3010`
 * and forward here to the real object store (`S3_UPSTREAM`).
 *
 * Host header MUST stay as the browser sent it (localhost:3010) so SigV4 matches.
 * Node's `fetch` rewrites Host to the upstream hostname — use http.request instead.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPSTREAM = (process.env.S3_UPSTREAM || 'http://116.205.229.31:3010').replace(/\/$/, '');

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, HEAD, DELETE, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'ETag, Content-Length, Content-Type, x-amz-request-id',
  'Access-Control-Max-Age': '3600',
};

const hopByHop = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

function proxyRequest(req: NextRequest): Promise<NextResponse> {
  const incoming = new URL(req.url);
  // Keep the exact path the client signed (do not re-encode segments).
  const target = new URL(`${UPSTREAM}${incoming.pathname}${incoming.search}`);
  const signedHost = req.headers.get('host') || 'localhost:3010';

  const headers: Record<string, string | number | string[] | undefined> = {};
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (hopByHop.has(lower) || lower === 'host') return;
    if (lower.startsWith('access-control-')) return;
    headers[key] = value;
  });
  headers.host = signedHost;

  const lib = target.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const upstream = lib.request(
      {
        headers,
        hostname: target.hostname,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const out = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (!value) continue;
            const lower = key.toLowerCase();
            if (hopByHop.has(lower) || lower.startsWith('access-control-')) continue;
            if (Array.isArray(value)) value.forEach((v) => out.append(key, v));
            else out.set(key, value);
          }
          for (const [k, v] of Object.entries(CORS_HEADERS)) out.set(k, v);

          resolve(
            new NextResponse(Buffer.concat(chunks), {
              headers: out,
              status: res.statusCode || 502,
              statusText: res.statusMessage,
            }),
          );
        });
      },
    );

    upstream.on('error', (error) => {
      console.error('[lobe-s3-proxy] upstream failed:', error.message);
      resolve(NextResponse.json({ error: error.message }, { headers: CORS_HEADERS, status: 502 }));
    });

    // Stream request body when present
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      const reader = req.body.getReader();
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            upstream.write(value);
          }
          upstream.end();
        } catch (error) {
          upstream.destroy(error instanceof Error ? error : undefined);
        }
      };
      void pump();
    } else {
      upstream.end();
    }
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS, status: 204 });
}

export async function GET(req: NextRequest) {
  return proxyRequest(req);
}

export async function HEAD(req: NextRequest) {
  return proxyRequest(req);
}

export async function PUT(req: NextRequest) {
  return proxyRequest(req);
}

export async function POST(req: NextRequest) {
  return proxyRequest(req);
}

export async function DELETE(req: NextRequest) {
  return proxyRequest(req);
}
