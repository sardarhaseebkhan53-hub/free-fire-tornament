'use client';
// User app shell — slim left sidebar + top chips, per design 12/14/16/17.
// Desktop: fixed sidebar; mobile: compact header (bottom nav handles tabs).
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell, ChevronsUpDown, Gift, Headphones, LayoutDashboard, LogOut, Menu, Plus,
  Settings, Swords, Trophy, Users, Wallet as WalletIcon, X,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import { Avatar } from '@/components/ui';
import { NexaWidget } from '@/components/nexa-widget';

export interface Me {
  id: string;
  username: string;
  role: string;
  isVerified: boolean;
  referralCode: string;
  profile: { fullName: string; freeFireIGN: string | null; freeFireUID: string | null } | null;
  wallet: { cashBalance: number; coinBalance: number; winningBalance: number; bonusBalance: number } | null;
}

interface NavItem {
  href?: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  soon?: boolean;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/matches', label: 'My Matches', icon: Swords },
  { href: '/wallet', label: 'Wallet', icon: WalletIcon },
  { href: '/teams', label: 'Teams', icon: Users },
  { href: '/tournaments', label: 'Tournaments', icon: Trophy },
  { label: 'Referrals', icon: Gift, soon: true },
  { label: 'Notifications', icon: Bell, soon: true },
  { label: 'Settings', icon: Settings, soon: true },
  { href: '/support/tickets', label: 'Support', icon: Headphones },
];

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-input bg-gradient-to-br from-accent to-accent-strong font-display text-base font-bold text-white shadow-[0_0_20px_rgba(139,92,246,0.55)]">
        C
      </span>
      <span>
        <span className="block font-display text-lg font-bold leading-none tracking-tight text-fg">
          CLUTCH<span className="text-accent">NEX</span>
        </span>
        <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.22em] text-fg-3">
          Premium Free Fire Esports
        </span>
      </span>
    </Link>
  );
}

export function UserShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // The drawer is bound to the route it was opened on, so any navigation
  // closes it without needing a synchronous setState inside an effect.
  const [drawerRoute, setDrawerRoute] = useState<string | null>(null);
  const drawerOpen = drawerRoute === pathname;
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!localStorage.getItem('cn_access')) return;
    api<Me>('/auth/me').then(setMe).catch(() => setMe(null));
  }, [pathname]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function logout() {
    await fetch('/api/backend/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    localStorage.removeItem('cn_access');
    window.dispatchEvent(new Event('storage'));
    router.push('/');
  }

  const total = me?.wallet
    ? Number(me.wallet.cashBalance) + Number(me.wallet.coinBalance) + Number(me.wallet.winningBalance) + Number(me.wallet.bonusBalance)
    : 0;

  const navList = (
    <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="User app">
      {NAV.map((item) => {
        const Icon = item.icon;
        if (item.soon || !item.href) {
          return (
            <span
              key={item.label}
              className="flex cursor-not-allowed items-center gap-3 rounded-input px-3 py-2.5 text-sm font-medium text-fg-3/70"
              title={`${item.label} — coming in a later phase`}
            >
              <Icon size={18} />
              {item.label}
              <span className="ml-auto rounded-pill border border-line px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-fg-3">Soon</span>
            </span>
          );
        }
        const active = item.href === '/wallet' ? pathname.startsWith('/wallet') : pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 rounded-input px-3 py-2.5 text-sm font-medium transition ${
              active
                ? 'bg-gradient-to-r from-accent to-accent-strong text-white shadow-[0_4px_18px_rgba(139,92,246,0.35)]'
                : 'text-fg-2 hover:bg-white/5 hover:text-fg'
            }`}
          >
            <Icon size={18} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const profileCard = me && (
    <div className="mx-3 mb-3 rounded-card border border-line bg-white/[3%] p-3">
      <div className="flex items-center gap-3">
        <Avatar name={me.username} size={38} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">{me.username}</p>
          <p className="text-[11px] text-fg-3">
            UID: {me.profile?.freeFireUID ?? '—'} {me.isVerified && <span className="text-success">✓</span>}
          </p>
        </div>
      </div>
      <button
        onClick={logout}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-input border border-line py-2 text-xs font-semibold text-fg-2 transition hover:border-danger/40 hover:text-danger"
      >
        <LogOut size={14} /> Logout
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-base">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface/60 pt-6 lg:flex">
        <div className="mb-8 px-1">
          <Logo />
        </div>
        {navList}
        <div className="mt-auto pt-4">{profileCard}</div>
      </aside>

      <div className="lg:pl-64">
        {/* Mobile header — design 42: hamburger + wordmark + bell */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-base/90 px-4 backdrop-blur-xl lg:hidden">
          <button
            onClick={() => setDrawerRoute(pathname)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="flex h-10 w-10 items-center justify-center rounded-input text-fg-2 transition hover:text-fg active:scale-95"
          >
            <Menu size={20} />
          </button>
          <Link href="/dashboard" className="flex flex-col items-center leading-none">
            <span className="font-display text-lg font-bold tracking-tight text-fg">
              CLUTCH<span className="text-accent">NEX</span>
            </span>
            <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.24em] text-fg-3">
              Premium Free Fire Esports
            </span>
          </Link>
          <button
            className="relative flex h-9 w-9 items-center justify-center rounded-input text-fg-2 transition hover:text-fg"
            title="Notifications — coming soon"
            disabled
          >
            <Bell size={18} />
          </button>
        </header>

        {/* Mobile drawer — design 42 */}
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
            <div className="animate-fade-in absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setDrawerRoute(null)} />
            <div className="animate-drawer-in absolute inset-y-0 left-0 flex w-[17.5rem] max-w-[86vw] flex-col overflow-y-auto border-r border-line bg-surface pt-6 shadow-2xl">
              <div className="mb-6 flex items-center justify-between px-4">
                <Logo />
                <button
                  onClick={() => setDrawerRoute(null)}
                  aria-label="Close menu"
                  className="flex h-8 w-8 items-center justify-center rounded-input border border-line text-fg-3"
                >
                  <X size={15} />
                </button>
              </div>
              {navList}
              <div className="mt-auto pt-4">{profileCard}</div>
            </div>
          </div>
        )}

        {/* Top chips row (desktop) */}
        <div className="hidden items-center justify-end gap-3 px-8 pt-6 lg:flex">
          {me && (
            <Link
              href="/wallet"
              className="flex items-center gap-2 rounded-pill border border-line bg-white/[3%] py-1.5 pl-3.5 pr-1.5 text-sm font-bold text-fg transition hover:border-accent/40"
            >
              <WalletIcon size={15} className="text-accent" />
              <span className="tabular">PKR {total.toLocaleString('en-PK')}</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white">
                <Plus size={13} />
              </span>
            </Link>
          )}
          <button
            className="flex h-9 w-9 items-center justify-center rounded-pill border border-line text-fg-2 transition hover:text-fg"
            title="Notifications — coming soon"
            disabled
          >
            <Bell size={16} />
          </button>
          {me && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-pill border border-line py-1 pl-1 pr-3 transition hover:border-accent/40"
              >
                <Avatar name={me.username} size={28} />
                <span className="text-sm font-semibold text-fg">{me.username}</span>
                <ChevronsUpDown size={14} className="text-fg-3" />
              </button>
              {menuOpen && (
                <div className="animate-rise absolute right-0 top-11 w-48 rounded-card border border-line bg-surface p-1.5 shadow-2xl">
                  <Link href="/dashboard" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 rounded-input px-3 py-2 text-sm text-fg-2 hover:bg-white/5 hover:text-fg">
                    <LayoutDashboard size={15} /> Dashboard
                  </Link>
                  <Link href="/wallet" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 rounded-input px-3 py-2 text-sm text-fg-2 hover:bg-white/5 hover:text-fg">
                    <WalletIcon size={15} /> Wallet
                  </Link>
                  <button onClick={logout} className="flex w-full items-center gap-2 rounded-input px-3 py-2 text-sm text-fg-2 hover:bg-white/5 hover:text-danger">
                    <LogOut size={15} /> Logout
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-12">{children}</div>
      </div>

      {/* NEXA assistant + WhatsApp — design 44/42 (Phase 11) */}
      <NexaWidget />
    </div>
  );
}

export function PageTitle({ title, sub, back }: { title: string; sub?: string; back?: string }) {
  return (
    <div className="mb-6">
      {back && (
        <Link
          href={back}
          className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-input border border-line text-fg-2 transition hover:text-fg"
          aria-label="Back"
        >
          <X size={16} className="rotate-45" />
        </Link>
      )}
      <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">{title}</h1>
      {sub && <p className="mt-1 text-sm text-fg-2">{sub}</p>}
    </div>
  );
}
