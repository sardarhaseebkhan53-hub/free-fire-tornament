'use client';
// Client island: auth-aware desktop actions + the design-41 mobile header
// (logo stays in navbar.tsx; this renders search + bell + hamburger menu).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Bell, LogOut, Menu, Search, Wallet, X } from 'lucide-react';
import { notifySessionChange } from '@/lib/session';
import { NotificationsBell } from '@/components/notifications-bell';
import { NAV_LINKS } from '@/components/navbar';

interface Session {
  sub: string;
  username: string;
  role: string;
}

function readSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('cn_access');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp * 1000 < Date.now()) return null;
    return { sub: payload.sub, username: payload.username, role: payload.role };
  } catch {
    return null;
  }
}

let cachedToken: string | null = null;
let cachedSession: Session | null = null;

/** Stable snapshot — only re-derives when the stored token actually changes. */
function sessionSnapshot(): Session | null {
  const token = localStorage.getItem('cn_access');
  if (token !== cachedToken) {
    cachedToken = token;
    cachedSession = readSession();
  }
  return cachedSession;
}

function subscribeSession(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

export function NavbarClient() {
  // localStorage is an external store: read it through useSyncExternalStore so
  // the server render, hydration and later updates all stay consistent.
  const session = useSyncExternalStore(subscribeSession, sessionSnapshot, () => null);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu on Escape. Links close the panel on click (route
  // changes are handled by the click, not a pathname effect).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function logout() {
    setOpen(false);
    try {
      await fetch('/api/backend/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-clutchnex-client': 'web' },
      });
    } finally {
      localStorage.removeItem('cn_access');
      notifySessionChange();
    }
  }

  return (
    <>
      {/* Desktop actions — design 01 */}
      <div className="hidden items-center gap-2 lg:flex">
        {session ? (
          <>
            <NotificationsBell />
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-input border border-line px-3 py-2 text-sm font-semibold text-fg transition hover:border-accent/40"
            >
              <Wallet size={15} className="text-accent" /> {session.username}
            </Link>
            <button
              onClick={logout}
              aria-label="Log out"
              className="touch-target rounded-input border border-line p-2 text-fg-2 transition hover:text-danger"
            >
              <LogOut size={16} />
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="rounded-input px-4 py-2 text-sm font-semibold text-fg-2 transition hover:text-fg">
              Login
            </Link>
            <Link
              href="/register"
              className="press rounded-input bg-accent px-4 py-2 text-sm font-bold text-white shadow-[0_0_18px_rgba(139,92,246,0.35)] transition duration-200 hover:bg-accent-strong hover:shadow-[0_0_24px_rgba(139,92,246,0.55)]"
            >
              Register
            </Link>
          </>
        )}
      </div>

      {/* Mobile header icons — search + bell (notifications when signed in,
          support for visitors) + hamburger menu */}
      <div className="flex items-center gap-1.5 lg:hidden">
        <Link
          href="/tournaments"
          aria-label="Search tournaments"
          className="press touch-target flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white/[3%] text-fg-2 transition hover:text-fg"
        >
          <Search size={16} />
        </Link>
        {session ? (
          <NotificationsBell />
        ) : (
          <Link
            href="/support"
            aria-label="Updates & support"
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white/[3%] text-fg-2 transition hover:text-fg"
          >
            <Bell size={16} />
            <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-danger" />
          </Link>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="press touch-target flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white/[3%] text-fg transition hover:text-accent"
        >
          {open ? <X size={17} /> : <Menu size={17} />}
        </button>
      </div>

      {/* Mobile menu panel — animated slide-down, glass */}
      {open && (
        <div
          id="mobile-menu"
          className="menu-panel absolute inset-x-0 top-full border-b border-line bg-base/95 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.7)] backdrop-blur-2xl lg:hidden"
        >
          <nav className="mx-auto max-w-7xl px-4 py-4 sm:px-6" aria-label="Mobile">
            <ul className="flex flex-col">
              {NAV_LINKS.map((l) => {
                const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`flex min-h-[46px] items-center justify-between rounded-input px-4 text-[15px] font-semibold transition ${
                        active ? 'bg-accent/12 text-accent' : 'text-fg-2 hover:bg-white/5 hover:text-fg'
                      }`}
                    >
                      {l.label}
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex gap-2 border-t border-line pt-4">
              {session ? (
                <>
                  <Link
                    href="/dashboard"
                    onClick={() => setOpen(false)}
                    className="press flex flex-1 items-center justify-center gap-2 rounded-input bg-accent px-4 py-3 text-sm font-bold text-white"
                  >
                    <Wallet size={15} /> Dashboard
                  </Link>
                  <button
                    onClick={logout}
                    className="press flex flex-1 items-center justify-center gap-2 rounded-input border border-danger/30 px-4 py-3 text-sm font-semibold text-danger"
                  >
                    <LogOut size={15} /> Log out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="press flex flex-1 items-center justify-center rounded-input border border-line px-4 py-3 text-sm font-semibold text-fg-2"
                  >
                    Login
                  </Link>
                  <Link
                    href="/register"
                    onClick={() => setOpen(false)}
                    className="press flex flex-1 items-center justify-center rounded-input bg-accent px-4 py-3 text-sm font-bold text-white"
                  >
                    Register
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
