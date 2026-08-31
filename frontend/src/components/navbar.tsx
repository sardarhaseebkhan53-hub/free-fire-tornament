// Sticky glass navbar — spec §Navigation (public desktop + mobile).
import Image from 'next/image';
import Link from 'next/link';
import { NavbarClient } from './navbar-client';

// Design v2 §Desktop header — the full nine-item primary navigation. Items
// marked `secondary` fold away below 1280px so the bar never wraps or overflows.
export const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/matches', label: 'Matches' },
  { href: '/teams', label: 'Teams', secondary: true },
  { href: '/winners', label: 'Winners' },
  { href: '/blog', label: 'Blog', secondary: true },
  { href: '/legal/how-it-works', label: 'How It Works', secondary: true },
  { href: '/support', label: 'Support' },
];

export function Navbar() {
  // z-50 (not z-40): the mobile menu panel renders INSIDE this header, so the
  // header's own stacking context caps the panel's z-index. At z-40 the sibling
  // fixed chrome (bottom nav, WhatsApp/NEXA FABs, install banner — all z-40)
  // painted over the open menu.
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-base/80 chrome-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="CLUTCHNEX home" className="flex min-w-0 items-center gap-2">
          <Image
            src="/images/branding/clutchnex-logo.jpg"
            alt=""
            width={48}
            height={48}
            priority
            className="h-9 w-9 rounded-input object-cover sm:h-10 sm:w-10"
          />
          <span className="font-display text-lg font-bold tracking-tight text-fg sm:text-xl">
            CLUTCH<span className="text-accent">NEX</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-input px-2.5 py-2 text-[13px] font-medium text-fg-2 transition hover:bg-white/5 hover:text-fg xl:px-3 xl:text-sm ${
                l.secondary ? 'hidden xl:inline-flex' : ''
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <NavbarClient />
      </div>
    </header>
  );
}
