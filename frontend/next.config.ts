import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Sandbox preview hosts (proxied live previews)
  allowedDevOrigins: ['*.e2b.app', '*.arena.app'],
  // NOTE: /uploads/* is proxied by the route handler in
  // src/app/uploads/[...path]/route.ts, not via rewrites() here.
  // rewrites() destinations are baked in at BUILD time — if BACKEND_URL is
  // missing or later changed on the host, the rewrite silently keeps
  // pointing at the old value (localhost). The handler resolves
  // BACKEND_URL per request instead.
};

export default nextConfig;
