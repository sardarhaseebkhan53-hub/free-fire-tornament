// Offline fallback (Phase 13, design 46) — precached by the service worker and
// served for any navigation when the network is gone. Wallet, tickets and
// account data are never at risk: they live server-side.
import type { Metadata } from 'next';
import Link from 'next/link';
import { WifiOff } from 'lucide-react';
import { RetryButton } from './retry-button';

export const metadata: Metadata = {
  title: 'Offline | CLUTCHNEX',
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-16 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-full border border-accent/30 bg-accent/10 shadow-[0_0_40px_rgba(139,92,246,0.35)]">
        <WifiOff size={34} className="text-accent" />
      </span>
      <h1 className="mt-6 font-display text-2xl font-bold text-fg sm:text-3xl">You&apos;re offline</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-fg-2">
        The arena needs a connection. Your wallet, tickets and registrations are safe —
        reconnect to jump back into the tournaments.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <RetryButton />
        <Link
          href="/"
          className="rounded-input border border-line px-5 py-2.5 text-sm font-semibold text-fg-2 transition hover:text-fg"
        >
          Go to Home
        </Link>
      </div>
      <p className="mt-10 text-[10px] font-bold uppercase tracking-[0.22em] text-fg-3">
        CLUTCHNEX · offline mode
      </p>
    </div>
  );
}
