import type { Metadata, Viewport } from 'next';
import { InstallBanner, SwRegister } from '@/components/pwa';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import { BottomNav } from '@/components/bottom-nav';
import { WhatsAppFab } from '@/components/whatsapp-fab';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_URL ?? 'http://localhost:3000'),
  title: {
    default: 'CLUTCHNEX — Free Fire Tournaments in Pakistan',
    template: '%s | CLUTCHNEX',
  },
  description:
    'Join competitive Free Fire tournaments — Solo, Duo, Squad and Clash Squad. Verified prize pools, manual payment verification, fast withdrawals. Compete. Clutch. Conquer.',
  openGraph: {
    siteName: 'CLUTCHNEX',
    title: 'CLUTCHNEX — Free Fire Tournaments in Pakistan',
    description: 'The arena is calling. Join Free Fire tournaments and win verified prizes.',
    type: 'website',
  },
  // PWA (Phase 13) — installable standalone app.
  manifest: '/manifest.webmanifest',
  applicationName: 'CLUTCHNEX',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CLUTCHNEX',
  },
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: '#070A14',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-screen flex-col bg-base text-fg">
        {children}
        <BottomNav />
        <WhatsAppFab />
        <SwRegister />
        <InstallBanner />
      </body>
    </html>
  );
}
