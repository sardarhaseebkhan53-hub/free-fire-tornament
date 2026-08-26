'use client';
// Client island: mobile menu toggle + auth-aware actions (login/register or
// dashboard chip). Access token is read from localStorage (set on login).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LogOut, Menu, Wallet, X } from 'lucide-react';

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

const MOBILE_LINKS = [
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/winners', label: 'Winners' },
  { href: '/blog', label: 'Blog' },
  { href: '/support', label: 'Support' },
];

export function NavbarClient() {
  const [open, setOpen] = useState(false);
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

      {/* Mobile menu button */}
      <button
        onClick={() => setOpen(!open)}
        aria-label="Menu"
        aria-expanded={open}
        className="rounded-input border border-line p-2 text-fg-2 lg:hidden"
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>

      {open && (
        <div className="glass absolute inset-x-0 top-16 border-b border-line bg-base/95 p-4 lg:hidden">
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            {MOBILE_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-input px-3 py-2.5 text-sm font-medium text-fg-2 hover:bg-white/5 hover:text-fg"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex gap-2 border-t border-line pt-3">
            {session ? (
              <>
                <Link href="/dashboard" onClick={() => setOpen(false)} className="flex-1 rounded-input bg-accent px-4 py-2.5 text-center text-sm font-bold text-white">
                  Dashboard
                </Link>
                <button onClick={logout} className="rounded-input border border-line px-4 py-2.5 text-sm font-semibold text-fg-2">
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link href="/login" onClick={() => setOpen(false)} className="flex-1 rounded-input border border-line px-4 py-2.5 text-center text-sm font-semibold text-fg">
                  Login
                </Link>
                <Link href="/register" onClick={() => setOpen(false)} className="flex-1 rounded-input bg-accent px-4 py-2.5 text-center text-sm font-bold text-white">
                  Register
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
