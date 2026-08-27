// PWA manifest (Phase 13) — served at /manifest.webmanifest. Standalone app,
// obsidian theme, maskable + standard icons from /icons (see scripts/gen-icons.sh).
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CLUTCHNEX — Free Fire Tournaments',
    short_name: 'CLUTCHNEX',
    description:
      'Free Fire tournaments in Pakistan — Solo, Duo, Squad and Clash Squad with verified PKR prize pools. Compete. Clutch. Conquer.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#070A14',
    theme_color: '#070A14',
    categories: ['games', 'sports', 'entertainment'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Tournaments', url: '/tournaments', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'My Matches', url: '/matches', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Wallet', url: '/wallet', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
