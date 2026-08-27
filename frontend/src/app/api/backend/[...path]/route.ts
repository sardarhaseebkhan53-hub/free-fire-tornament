// =============================================================================
// Browser-safe API proxy.
//
// The user's browser is NOT the sandbox/backend host, so client components
// call relative URLs (/api/backend/...) and this handler forwards them to the
// Express API. Auth cookies are forwarded both ways (path rewritten so the
// browser sends the refresh cookie back through this proxy).
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL } from '@/lib/api';

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const search = req.nextUrl.searchParams.toString();
  const target = `${BACKEND_URL}/api/${path.join('/')}${search ? `?${search}` : ''}`;

  const headers: Record<string, string> = {};
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  const auth = req.headers.get('authorization');
  if (auth) headers.authorization = auth;
  const cookie = req.headers.get('cookie');
  if (cookie) headers.cookie = cookie;
  // Security headers the API relies on: the CSRF marker, the browser's own
  // fetch metadata, and the real client IP (the API is one hop behind us).
  const client = req.headers.get('x-clutchnex-client');
  if (client) headers['x-clutchnex-client'] = client;
  const site = req.headers.get('sec-fetch-site');
  if (site) headers['sec-fetch-site'] = site;
  const ua = req.headers.get('user-agent');
  if (ua) headers['user-agent'] = ua;
  const fwd = req.headers.get('x-forwarded-for');
  headers['x-forwarded-for'] = fwd ? `${fwd}, ${req.headers.get('x-real-ip') ?? ''}`.replace(/, $/, '') : '127.0.0.1';

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    return NextResponse.json(
      { success: false, code: 'BACKEND_UNAVAILABLE', message: 'API is unreachable right now.' },
      { status: 502 },
    );
  }

  const data = await upstream.arrayBuffer();
  const res = new NextResponse(data, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });

  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const c of setCookies) {
    res.headers.append('set-cookie', c.replace(/path=\/api\/auth/i, 'path=/api/backend/auth'));
  }
  return res;
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;

export const runtime = 'nodejs';
