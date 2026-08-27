'use client';
// Client island: auth-aware desktop actions + the design-41 mobile header
// (logo stays in navbar.tsx; this renders search + bell — no drawer).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bell, LogOut, Search, Wallet } from 'lucide-react';

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

export function NavbarClient() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    setSession(readSession());
    const onStorage = () => setSession(readSession());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  async function logout() {
    try {
      await fetch('/api/backend/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      localStorage.removeItem('cn_access');
      setSession(null);
    }
  }

  return (
    <>
      {/* Desktop actions — design 01 */}
      <div className="hidden items-center gap-2 lg:flex">
        {session ? (
          <>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-input border border-line px-3 py-2 text-sm font-semibold text-fg transition hover:border-accent/40"
            >
              <Wallet size={15} className="text-accent" /> {session.username}
            </Link>
            <button
              onClick={logout}
              aria-label="Log out"
              className="rounded-input border border-line p-2 text-fg-2 transition hover:text-danger"
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
              className="rounded-input bg-accent px-4 py-2 text-sm font-bold text-white shadow-[0_0_18px_rgba(139,92,246,0.35)] transition hover:bg-accent-strong"
            >
              Register
            </Link>
          </>
        )}
      </div>

      {/* Mobile header icons — design 41: search + bell */}
      <div className="flex items-center gap-2 lg:hidden">
        <Link
          href="/tournaments"
          aria-label="Search tournaments"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white/[3%] text-fg-2 transition hover:text-fg"
        >
          <Search size={16} />
        </Link>
        <Link
          href="/support"
          aria-label="Updates & support"
          className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white/[3%] text-fg-2 transition hover:text-fg"
        >
          <Bell size={16} />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-danger" />
        </Link>
      </div>
    </>
  );
}
