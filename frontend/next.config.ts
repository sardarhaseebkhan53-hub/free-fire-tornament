import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Sandbox preview hosts (proxied live previews)
  allowedDevOrigins: ['*.e2b.app', '*.arena.app'],
  async rewrites() {
    return [];
  },
};

export default nextConfig;
