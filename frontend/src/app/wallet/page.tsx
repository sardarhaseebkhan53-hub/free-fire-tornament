'use client';
// Wallet page — balances from the backend. Deposit/withdraw flows connect in
// Phase 7; until then this page shows real data and honest next steps.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, ShieldCheck } from 'lucide-react';
import { money } from '@/lib/format';

interface Me {
  wallet: { cashBalance: string; coinBalance: string; winningBalance: string; bonusBalance: string } | null;
}

export default function WalletPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'authed' | 'anon'>('loading');

  useEffect(() => {
    const token = localStorage.getItem('cn_access');
    if (!token) return setState('anon');
    fetch('/api/backend/auth/me', { headers: { authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const json = await r.json();
        if (json.success) { setMe(json.data); setState('authed'); } else setState('anon');
      })
      .catch(() => setState('anon'));
  }, []);

  if (state === 'loading') {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 size={24} className="animate-spin text-accent" /></div>;
  }
  if (state === 'anon' || !me) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-display text-2xl font-bold text-fg">Sign in to view your wallet</h1>
        <Link href="/login?next=/wallet" className="mt-6 inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white">
          Sign In
        </Link>
      </div>
    );
  }

  const w = me.wallet;
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-2xl font-bold text-fg">Wallet</h1>
      <p className="mt-1 text-sm text-fg-2">
        Every movement is recorded in an immutable ledger — deposits, entries, refunds and prizes.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Cash Balance', w?.cashBalance, 'text-fg', 'Deposited funds'],
          ['Tournament Credits', w?.coinBalance, 'text-accent', 'Entry credits'],
          ['Winning Balance', w?.winningBalance, 'text-reward', 'Withdrawable winnings'],
          ['Bonus Balance', w?.bonusBalance, 'text-success', 'Promotional rewards'],
        ].map(([label, val, tone, sub]) => (
          <div key={label as string} className="glass rounded-card px-5 py-4">
            <p className={`tabular font-display text-2xl font-bold ${tone}`}>{money((val as string) ?? '0')}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-fg-3">{label}</p>
            <p className="text-[11px] text-fg-3">{sub}</p>
          </div>
        ))}
      </div>

      <div className="glass mt-8 flex items-start gap-3 rounded-card p-5">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-success" />
        <p className="text-sm text-fg-2">
          <strong className="text-fg">Add Money &amp; Withdraw are being connected to the verified payment pipeline</strong> —
          JazzCash, EasyPaisa and bank transfer with human-reviewed approvals. Until then, balances shown here are live
          and ledger-accurate.
        </p>
      </div>
    </div>
  );
}
