import type { Metadata, Viewport } from 'next';
import { Navbar } from '@/components/navbar';
import { Footer } from '@/components/footer';
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
        <Navbar />
        <main className="flex-1 pb-24 lg:pb-0">{children}</main>
        <Footer />
        <BottomNav />
        <WhatsAppFab />
      </body>
    </html>
  );
}
