import type { NextConfig } from 'next';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  // Sandbox preview hosts (proxied live previews)
  allowedDevOrigins: ['*.e2b.app', '*.arena.app'],
  async rewrites() {
    return [
      // Admin-uploaded public files (tournament banners, ad creatives, blog
      // covers) live in the API's uploads directory — serve them through the
      // same origin so image URLs never point at another host. Private dirs
      // (deposits/results/tickets) stay blocked by the API's own gate.
      { source: '/uploads/:path*', destination: `${BACKEND_URL}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
