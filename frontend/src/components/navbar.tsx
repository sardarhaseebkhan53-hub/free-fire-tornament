// Sticky glass navbar — spec §Navigation (public desktop + mobile).
import Link from 'next/link';
import { NavbarClient } from './navbar-client';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/winners', label: 'Winners' },
  { href: '/blog', label: 'Blog' },
  { href: '/support', label: 'Support' },
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-base/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-input bg-accent font-display text-sm font-bold text-white shadow-[0_0_18px_rgba(139,92,246,0.5)]">
            C
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-fg">
            CLUTCH<span className="text-accent">NEX</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-input px-3 py-2 text-sm font-medium text-fg-2 transition hover:bg-white/5 hover:text-fg"
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
