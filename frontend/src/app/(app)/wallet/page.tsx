'use client';
// My Wallet — design 14 (v2: ONE primary PKR wallet). Available Balance hero,
// recent ledger activity, send-money, minimum-withdrawal and WhatsApp support
// cards. All values are live API data; coins/diamonds are gone from player UI.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Gift, Headset, Plus, Send, ShieldCheck, Trophy, Upload, Wallet as WalletIcon } from 'lucide-react';
import { api } from '@/lib/client-api';
import { CopyChip, StatusPill, TypeChip } from '@/components/wallet/bits';
import { EmptyState, Skeleton } from '@/components/ui';
import { fmt, fmtDate } from '@/lib/format';
import { useHasSession } from '@/lib/session';

interface Tx {
  id: string; type: string; description: string | null; reference: string | null;
  amount: number; direction: 'CREDIT' | 'DEBIT'; status: string; createdAt: string;
}
interface Overview {
  wallet: {
    cashBalance: number; coinBalance: number; winningBalance: number; bonusBalance: number;
    balance?: number; withdrawable?: number;
  };
  settings: { minWithdrawal: number; withdrawalFeePercent: number };
  recentTransactions: Tx[];
}
interface PubSettings { 'platform.whatsappNumber'?: string }

export default function WalletPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [pub, setPub] = useState<PubSettings | null>(null);
  const [loaded, setLoaded] = useState<'loading' | 'ready' | 'error'>('loading');
  const hasSession = useHasSession();
  const state = hasSession === false ? 'anon' : hasSession === null ? 'loading' : loaded;

  useEffect(() => {
    if (!hasSession) return;
    Promise.all([
      api<Overview>('/wallet'),
      fetch('/api/backend/public/settings/public').then((r) => r.json()).then((j) => j.data as PubSettings).catch(() => ({})),
    ])
      .then(([o, p]) => { setData(o); setPub(p); setLoaded('ready'); })
      .catch(() => setLoaded('error'));
  }, [hasSession]);

  if (state === 'loading') {
    // Skeleton mirrors the balance hero + grid so the layout holds.
    return (
      <div className="mx-auto max-w-6xl" aria-busy="true" aria-label="Loading wallet">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
        <Skeleton className="mt-6 h-44 rounded-[20px]" />
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="mt-8 h-64" />
      </div>
    );
  }
  if (state === 'anon' || state === 'error') {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="font-display text-2xl font-bold text-fg">Sign in to view your wallet</h1>
        <p className="mt-2 text-sm text-fg-2">Balances, transactions and rewards live here.</p>
        <Link href="/login?next=/wallet" className="mt-6 inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white">
          Sign In
        </Link>
      </div>
    );
  }

  const w = data!.wallet;
  const s = data!.settings;
  // ONE primary PKR balance — server-computed when available.
  const total = typeof w.balance === 'number'
    ? w.balance
    : Number(w.cashBalance) + Number(w.winningBalance);
  const withdrawable = typeof w.withdrawable === 'number' ? w.withdrawable : Number(w.cashBalance) + Number(w.winningBalance);
  const wa = (pub?.['platform.whatsappNumber'] ?? '+923001234567').replace(/\D/g, '');

  const buckets = [
    { label: 'Deposits', value: w.cashBalance, icon: WalletIcon, tone: 'bg-accent/15 text-accent' },
    { label: 'Winnings', value: Number(w.winningBalance), icon: Trophy, tone: 'bg-reward/15 text-reward' },
    { label: 'Bonus', value: w.bonusBalance, icon: Gift, tone: 'bg-success/15 text-success' },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">My Wallet</h1>
      <p className="mt-1 text-sm text-fg-2">One PKR wallet — deposits in, entries out, winnings in.</p>

      {/* ---- Available Balance hero (design 14) ---- */}
      <div className="mt-6 rounded-[20px] bg-gradient-to-r from-accent/70 via-accent/25 to-reward/20 p-[1px] shadow-[0_0_40px_rgba(139,92,246,0.18)]">
        <div className="relative overflow-hidden rounded-[19px] bg-surface px-5 py-6 sm:px-8">
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-60"
            style={{ background: 'radial-gradient(60% 80% at 85% 20%, rgba(139,92,246,0.25), transparent 70%), radial-gradient(40% 60% at 70% 90%, rgba(245,185,66,0.12), transparent 70%)' }}
            aria-hidden
          />
          <div className="relative flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fg-2">Available Balance · PKR</p>
              <div className="mt-2 flex items-center gap-3">
                <span className="tabular font-display text-4xl font-bold text-fg sm:text-5xl">{fmt(total)}</span>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-success/30 bg-success/10 text-success" title="Verified wallet">
                  <ShieldCheck size={15} />
                </span>
              </div>
              <p className="mt-2 text-xs text-fg-3">
                <span className="font-semibold text-reward">{fmt(withdrawable)}</span> is withdrawable — deposits and winnings, subject to the minimum below.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <Link
                href="/wallet/add-money"
                className="flex items-center justify-center gap-2 rounded-input bg-gradient-to-r from-accent to-accent-strong px-7 py-3 text-sm font-bold text-white shadow-[0_6px_24px_rgba(139,92,246,0.4)] transition hover:brightness-110"
              >
                <Plus size={16} /> Add Money
              </Link>
              <div className="flex gap-2">
                <Link
                  href="/wallet/transfer"
                  className="flex flex-1 items-center justify-center gap-2 rounded-input border border-line bg-white/[3%] px-4 py-3 text-sm font-bold text-fg transition hover:border-accent/40"
                >
                  <Send size={16} /> Send
                </Link>
                <Link
                  href="/wallet/withdraw"
                  className="flex flex-1 items-center justify-center gap-2 rounded-input border border-line bg-white/[3%] px-4 py-3 text-sm font-bold text-fg transition hover:border-accent/40"
                >
                  <Upload size={16} /> Withdraw
                </Link>
              </div>
            </div>
          </div>

          <div className="relative mt-6 grid grid-cols-1 gap-3 rounded-card border border-line bg-base/60 p-3 sm:grid-cols-3 sm:divide-x sm:divide-line">
            {buckets.map((b) => {
              const Icon = b.icon;
              return (
                <div key={b.label} className="flex items-center gap-3 px-2 py-1.5 sm:justify-center sm:px-4">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${b.tone}`}>
                    <Icon size={17} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-fg-2">{b.label}</p>
                    <p className="tabular truncate font-display text-lg font-bold text-fg">{fmt(b.value)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---- Recent transactions ---- */}
      <section className="glass mt-6 rounded-card p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-fg">Recent Transactions</h2>
          <Link href="/wallet/transactions" className="flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
            View All Transactions <ArrowRight size={14} />
          </Link>
        </div>

        {data!.recentTransactions.length === 0 ? (
          <EmptyState title="No transactions yet" sub="Add money to enter your first tournament." />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-fg-3">
                    <th className="py-2.5 pr-4 font-medium">Type</th>
                    <th className="py-2.5 pr-4 font-medium">Description</th>
                    <th className="py-2.5 pr-4 font-medium">Reference ID</th>
                    <th className="py-2.5 pr-4 text-right font-medium">Amount</th>
                    <th className="py-2.5 pr-4 font-medium">Status</th>
                    <th className="py-2.5 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.recentTransactions.map((t) => (
                    <tr key={t.id} className="border-b border-line/60 last:border-0">
                      <td className="py-3 pr-4"><TypeChip type={t.type} /></td>
                      <td className="max-w-52 truncate py-3 pr-4 text-fg-2">{t.description ?? '—'}</td>
                      <td className="py-3 pr-4">
                        <span className="flex items-center gap-1.5 font-mono text-xs text-fg-2">
                          {t.reference ?? '—'} {t.reference && <CopyChip value={t.reference} />}
                        </span>
                      </td>
                      <td className={`tabular py-3 pr-4 text-right font-bold ${t.direction === 'CREDIT' ? 'text-success' : 'text-danger'}`}>
                        {t.direction === 'CREDIT' ? '+' : '−'}{fmt(t.amount, 2)}
                      </td>
                      <td className="py-3 pr-4"><StatusPill status={t.status} /></td>
                      <td className="whitespace-nowrap py-3 text-fg-3">{fmtDate(t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="flex flex-col gap-2.5 md:hidden">
              {data!.recentTransactions.map((t) => (
                <div key={t.id} className="rounded-card border border-line bg-white/[2%] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <TypeChip type={t.type} />
                    <span className={`tabular text-sm font-bold ${t.direction === 'CREDIT' ? 'text-success' : 'text-danger'}`}>
                      {t.direction === 'CREDIT' ? '+' : '−'}{fmt(t.amount, 2)}
                    </span>
                  </div>
                  <p className="mt-1.5 truncate text-xs text-fg-2">{t.description ?? '—'}</p>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-fg-3">
                    <StatusPill status={t.status} />
                    <span>{fmtDate(t.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ---- Bottom info cards ---- */}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Link href="/wallet/transfer" className="glass rounded-card p-5 transition hover:border-accent/40">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-accent">
              <Send size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg-2">Send Money</p>
              <p className="mt-0.5 font-display text-lg font-bold text-fg">Transfer to a player</p>
              <p className="mt-1 text-xs text-fg-3">Send PKR to any CLUTCHNEX player by username — instant, audited, secured.</p>
              <span className="mt-2.5 inline-block text-xs font-bold text-accent hover:underline">Send now →</span>
            </div>
          </div>
        </Link>

        <div className="rounded-card border border-warning/25 bg-warning/[4%] p-5">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-warning/30 bg-warning/10 text-warning">
              <ShieldCheck size={20} />
            </span>
            <div>
              <p className="text-sm font-semibold text-warning">Minimum Withdrawal</p>
              <p className="mt-0.5 font-display text-lg font-bold text-fg">{fmt(s.minWithdrawal)}</p>
              <p className="mt-1 text-xs text-fg-3">Minimum winnings required to withdraw.{s.withdrawalFeePercent > 0 ? ` Processing fee: ${s.withdrawalFeePercent}%.` : ' No processing fee.'}</p>
            </div>
          </div>
        </div>

        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-card border border-success/25 bg-success/[4%] p-5 transition hover:border-success/50"
        >
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-success/30 bg-success/10 text-success">
              <Headset size={20} />
            </span>
            <div>
              <p className="text-sm font-semibold text-success">Need Help?</p>
              <p className="mt-0.5 font-display text-lg font-bold text-fg">WhatsApp Support</p>
              <p className="mt-1 text-xs text-fg-3">Chat with our support team on WhatsApp.</p>
            </div>
            <ArrowRight size={16} className="ml-auto shrink-0 text-success" />
          </div>
        </a>
      </div>
    </div>
  );
}
