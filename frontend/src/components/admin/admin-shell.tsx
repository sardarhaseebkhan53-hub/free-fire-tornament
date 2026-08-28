'use client';
// Admin panel shell — design 26: sidebar with ADMIN badge + section nav,
// topbar with global search, bell and profile. RBAC-gated (ADMIN+).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowUpRight, BarChart3, CreditCard, FileText, Headphones,
  Home, LayoutDashboard, Loader2, Megaphone, Search, Send, Settings, Shield, ShieldAlert,
  ScrollText, Swords, TrendingUp, Trophy, Upload, UserRound, Users, Wallet, XCircle,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import { useHasSession } from '@/lib/session';
import { NotificationsBell } from '@/components/notifications-bell';

const NAV = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/tournaments', label: 'Tournaments', icon: Trophy },
  { href: '/admin/matches', label: 'Matches', icon: Swords },
  { href: '/admin/results', label: 'Results', icon: BarChart3 },
  { href: '/admin/deposits', label: 'Deposits', icon: Wallet },
  { href: '/admin/payment-accounts', label: 'Payment Accounts', icon: CreditCard },
  { href: '/admin/withdrawals', label: 'Withdrawals', icon: Upload },
  { href: '/admin/transfers', label: 'Transfers', icon: Send },
  { href: '/admin/finance', label: 'Financials', icon: TrendingUp },
  { href: '/admin/revenue', label: 'Revenue', icon: BarChart3 },
  { href: '/admin/support', label: 'Support', icon: Headphones },
  { href: '/admin/blog', label: 'Blog', icon: FileText },
  { href: '/admin/ads', label: 'Ads', icon: Megaphone },
  { href: '/admin/seo', label: 'SEO', icon: Search },
  { href: '/admin/fraud', label: 'Fraud & Abuse', icon: ShieldAlert },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
  { href: '/admin/audit-logs', label: 'Audit Logs', icon: ScrollText },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<{ username: string; role: string } | null>(null);
  const [loaded, setLoaded] = useState<'loading' | 'ok' | 'denied'>('loading');
  const hasSession = useHasSession();
  const state = hasSession === false ? 'denied' : hasSession === null ? 'loading' : loaded;
  // Bound to the route it was opened on so navigation closes it implicitly.
  const [drawerRoute, setDrawerRoute] = useState<string | null>(null);
  const drawer = drawerRoute === pathname;

  useEffect(() => {
    if (!hasSession) return;
    api<{ username: string; role: string }>('/auth/me')
      .then((m) => {
        if (['ADMIN', 'SUPER_ADMIN'].includes(m.role)) {
          setMe(m);
          setLoaded('ok');
        } else {
          setLoaded('denied');
        }
      })
      .catch(() => setLoaded('denied'));
  }, [hasSession]);

  if (state === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-base"><Loader2 className="animate-spin text-accent" /></div>;
  }
  if (state === 'denied' || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base px-4">
        <div className="glass max-w-md rounded-card p-10 text-center">
          <XCircle size={36} className="mx-auto text-danger" />
          <h1 className="mt-4 font-display text-xl font-bold text-fg">Admin access required</h1>
          <p className="mt-2 text-sm text-fg-2">Sign in with an admin account to open the control center.</p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/login?next=/admin" className="rounded-input bg-accent px-5 py-2.5 text-sm font-bold text-white">Sign In</Link>
            <button onClick={() => router.push('/')} className="rounded-input border border-line px-5 py-2.5 text-sm font-semibold text-fg-2">Back to site</button>
          </div>
        </div>
      </div>
    );
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-6">
        <Link href="/admin" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-input bg-gradient-to-br from-accent to-accent-strong font-display text-base font-bold text-white shadow-[0_0_20px_rgba(139,92,246,0.55)]">C</span>
          <span className="font-display text-lg font-bold tracking-tight text-fg">CLUTCH<span className="text-accent">NEX</span></span>
        </Link>
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-pill border border-accent/30 bg-accent/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-accent">
          <Shield size={11} /> Admin
        </span>
      </div>

      <nav className="mt-6 flex-1 flex-col gap-1 overflow-y-auto px-3" aria-label="Admin">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
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
              <Icon size={17} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4">
        <Link href="/" target="_blank" className="flex items-center justify-center gap-2 rounded-card border border-accent/30 bg-accent/[8%] px-4 py-3 text-xs font-bold text-accent transition hover:bg-accent/15">
          Visit Site <ArrowUpRight size={14} />
        </Link>
        <div className="mt-3 flex items-center gap-3 rounded-card border border-line bg-white/[3%] p-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 font-display text-sm font-bold text-accent">
            {me.username.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-fg">{me.username}</p>
            <p className="text-[11px] text-fg-3">{me.role.replace('_', ' ')}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-base">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-surface/60 lg:block">
        {sidebar}
      </aside>

      <div className="lg:pl-60">
        {/* Topbar — design 26 */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-base/90 px-4 backdrop-blur-xl sm:px-6">
          <button className="rounded-input p-2.5 text-fg-2 transition active:scale-95 lg:hidden" onClick={() => setDrawerRoute(pathname)} aria-label="Open menu" aria-expanded={drawer}>
            <UserRound size={18} />
          </button>
          <form
            className="flex flex-1 items-center gap-2 rounded-pill border border-line bg-white/[3%] px-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              const q = new FormData(e.currentTarget).get('q');
              router.push(`/admin/users?q=${encodeURIComponent(String(q ?? ''))}`);
            }}
          >
            <input
              name="q"
              placeholder="Search users, tournaments, matches..."
              className="w-full max-w-md bg-transparent text-sm text-fg outline-none placeholder:text-fg-3"
            />
            <Search size={15} className="text-fg-3" />
          </form>
          <NotificationsBell variant="admin" />
          <div className="flex items-center gap-2.5 rounded-pill border border-line py-1 pl-1 pr-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 font-display text-xs font-bold text-accent">
              {me.username.slice(0, 2).toUpperCase()}
            </span>
            <div className="hidden sm:block">
              <p className="text-xs font-bold leading-none text-fg">Admin</p>
              <p className="mt-0.5 text-[10px] leading-none text-fg-3">{me.role.replace('_', ' ')}</p>
            </div>
          </div>
        </header>

        <div className="px-4 py-6 sm:px-6">{children}</div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="animate-fade-in absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setDrawerRoute(null)} />
          <div className="animate-drawer-in absolute inset-y-0 left-0 w-64 max-w-[85vw] overflow-y-auto border-r border-line bg-surface shadow-2xl">{sidebar}</div>
        </div>
      )}
    </div>
  );
}

export function AdminPageTitle({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold text-fg">{title}</h1>
        {sub && <p className="mt-1 text-sm text-fg-2">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function AdminHomeLink() {
  return <Home size={16} className="hidden" />;
}
