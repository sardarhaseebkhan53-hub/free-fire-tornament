// =============================================================================
// Same-origin proxy for admin-uploaded public files (tournament banners,
// ad creatives, blog covers). The files live on the API's persistent
// UPLOAD_DIR volume, so image URLs never point at another host. Private
// dirs (deposits/results/tickets) stay blocked by the API's own gate.
//
// Implemented as a route handler — NOT a next.config.ts rewrites() entry —
// so BACKEND_URL is resolved at request time. A rewrites() destination is
// baked in at build time: if BACKEND_URL is missing or changed on the host,
// the rewrite silently points at localhost forever. This handler reads the
// env per request, like the /api/backend/[...path] proxy does.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL } from '@/lib/api';

export const runtime = 'nodejs';

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const search = req.nextUrl.searchParams.toString();
  // Next hands us already-decoded segments; re-encode each one so the
  // upstream (Express static) receives the original file name.
  const file = path.map((p) => encodeURIComponent(p)).join('/');
  const target = `${BACKEND_URL}/uploads/${file}${search ? `?${search}` : ''}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, { method: req.method, cache: 'no-store' });
  } catch {
    return new NextResponse('API is unreachable right now.', { status: 502 });
  }

  const headers = new Headers();
  for (const name of [
    'content-type',
    'content-length',
    'content-disposition',
    'cache-control',
    'etag',
  ] as const) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export const GET = proxy;
export const HEAD = proxy;
