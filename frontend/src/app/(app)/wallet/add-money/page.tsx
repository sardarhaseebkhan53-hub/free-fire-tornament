'use client';
// Add Money — design 15. Step 1 (amount) + step 2 (method); step 3 continues
// to /wallet/payment where the manual payment proof is submitted.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Clock, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { api, getToken } from '@/lib/client-api';
import { MethodBrand, METHOD_LABEL, type Method } from '@/components/wallet/bits';
import { fmt } from '@/lib/format';

interface Overview {
  wallet: { cashBalance: number };
  settings: { coinConversionRate: number; depositBonusPercent: number; minDeposit: number; maxDeposit: number };
}
interface PubSettings { 'platform.whatsappNumber'?: string }

interface Account {
  id: string; method: Method; label: string; accountName: string;
  accountNumber: string; instructions: string | null;
}

const QUICK = [100, 250, 500, 1000, 2500];

export default function AddMoneyPage() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [pub, setPub] = useState<PubSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [amount, setAmount] = useState('500');
  const [method, setMethod] = useState<Method>('JAZZCASH');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) { router.replace('/login?next=/wallet/add-money'); return; }
    api<Overview>('/wallet').then(setData).catch(() => {});
    // Payment destinations are admin-managed and must be the single source of
    // truth: removing/hiding an account in admin immediately removes it here.
    // Never hard-code the method list on this page (that is what caused an
    // admin-deleted method to keep appearing on Add Money).
    api<{ accounts: Account[] }>('/wallet/payment-accounts')
      .then((d) => {
        setAccounts(d.accounts);
        setMethod((current) => {
          if (d.accounts.some((a) => a.method === current)) return current;
          return d.accounts[0]?.method ?? 'JAZZCASH';
        });
      })
      .catch(() => setAccounts([]));
    fetch('/api/backend/public/settings/public').then((r) => r.json()).then((j) => setPub(j.data)).catch(() => {});
  }, [router]);

  const methods = (accounts ?? []).map((a) => ({
    id: a.method,
    title: METHOD_LABEL[a.method] ?? a.label,
    sub: a.label || 'Pay securely using your account',
  }));

  const amt = Number(amount || 0);
  // Deposits credit the single PKR wallet directly — no artificial coins.
  const bonus = data ? Math.floor(amt * data.settings.depositBonusPercent) / 100 : 0;
  const wa = (pub?.['platform.whatsappNumber'] ?? '+923001234567').replace(/[^\d]/g, '');

  function submit() {
    setError(null);
    if (!data) return;
    if (!Number.isInteger(amt) || amt < data.settings.minDeposit) {
      return setError(`Minimum deposit is ${fmt(data.settings.minDeposit)}.`);
    }
    if (amt > data.settings.maxDeposit) {
      return setError(`Maximum deposit is ${fmt(data.settings.maxDeposit)}.`);
    }
    if (accounts && accounts.length === 0) {
      return setError('No payment methods are configured right now. Please contact support to add funds.');
    }
    router.push(`/wallet/payment?amount=${amt}&method=${method}`);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">Add Money</h1>
      <p className="mt-1 text-sm text-fg-2">Add funds to your wallet and play in premium tournaments</p>

      {/* Stepper */}
      <ol className="mt-6 flex items-center gap-2 text-xs font-semibold sm:gap-0">
        {[
          { n: 1, label: 'Choose Amount', active: true },
          { n: 2, label: 'Payment Method', active: true },
          { n: 3, label: 'Submit Proof', active: false },
        ].map((step, i) => (
          <li key={step.n} className={`flex items-center ${i < 2 ? 'flex-1' : ''}`}>
            <span className="flex items-center gap-2.5">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                step.active ? 'bg-accent text-white shadow-[0_0_16px_rgba(139,92,246,0.5)]' : 'border border-line text-fg-3'
              }`}>
                {step.n}
              </span>
              <span className={step.active ? 'text-fg' : 'text-fg-3'}>{step.label}</span>
            </span>
            {i < 2 && <span className={`mx-3 hidden h-px flex-1 sm:block ${step.active ? 'bg-accent/50' : 'bg-line'}`} />}
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="glass rounded-card p-5 sm:p-7">
          {/* Amount */}
          <h2 className="font-display text-base font-bold text-fg">Enter Amount</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_260px]">
            <div>
              <div className="flex items-center rounded-input border border-accent bg-accent/[6%] px-4 shadow-[0_0_0_3px_rgba(139,92,246,0.12)]">
                <span className="font-display text-2xl text-accent">PKR </span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  aria-label="Amount in PKR"
                  className="w-full bg-transparent px-3 py-3.5 font-display text-2xl font-bold text-fg outline-none"
                />
              </div>
              <p className="mt-3 text-xs font-semibold text-fg-2">Quick Select</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    onClick={() => setAmount(String(q))}
                    className={`rounded-pill border px-4 py-1.5 text-sm font-semibold transition ${
                      amt === q
                        ? 'border-accent bg-accent text-white'
                        : 'border-line bg-white/[3%] text-fg-2 hover:border-accent/40 hover:text-fg'
                    }`}
                  >
                    PKR {q.toLocaleString('en-PK')}
                  </button>
                ))}
              </div>
            </div>

            {/* You will receive */}
            <div className="rounded-card border border-line bg-gradient-to-b from-accent/[8%] to-transparent p-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-2">Your wallet will be credited (after approval)</p>
              <div className="mt-3 flex items-center justify-center gap-3">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-reward to-[#d29020] font-display text-xl font-bold text-white shadow-[0_0_24px_rgba(245,185,66,0.4)]">
                  ₨
                </span>
                <div className="text-left">
                  <p className="tabular font-display text-3xl font-bold text-accent">{amt.toLocaleString('en-PK')}</p>
                  <p className="text-xs font-semibold text-fg-2">PKR — one wallet, real money</p>
                  {bonus > 0 && <p className="text-xs font-bold text-success">+ {bonus.toLocaleString('en-PK')} deposit bonus</p>}
                </div>
              </div>
            </div>
          </div>

          {/* Method */}
          <h2 className="mt-7 font-display text-base font-bold text-fg">Select Payment Method</h2>
          {accounts === null ? (
            <div className="mt-4 flex items-center justify-center rounded-card border border-line py-6 text-sm text-fg-3">
              <Loader2 className="mr-2 animate-spin text-accent" /> Loading payment methods…
            </div>
          ) : methods.length === 0 ? (
            <div className="mt-4 rounded-input border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
              No payment methods are active. Please contact support to add funds.
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {methods.map((m, index) => {
                const active = method === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    className={`flex items-center gap-4 rounded-card border px-4 py-3.5 text-left transition ${
                      active
                        ? 'border-accent bg-accent/[7%] shadow-[0_0_0_3px_rgba(139,92,246,0.12)]'
                        : 'border-line bg-white/[2%] hover:border-fg-3/40'
                    }`}
                  >
                    <span className={`flex h-4.5 w-4.5 items-center justify-center rounded-full border-2 ${active ? 'border-accent' : 'border-fg-3/50'}`} style={{ width: 18, height: 18 }}>
                      {active && <span className="h-2 w-2 rounded-full bg-accent" />}
                    </span>
                    <MethodBrand method={m.id} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-fg">{m.title}</span>
                      <span className="block truncate text-xs text-fg-3">{m.sub}</span>
                    </span>
                    {index === 0 && (
                      <span className="hidden rounded-pill bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent sm:block">
                        Recommended
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-5 flex items-start gap-3 rounded-card border border-line bg-base/60 p-4">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-info" />
            <p className="text-xs leading-relaxed text-fg-2">
              Payments are verified manually within 30 minutes.<br className="hidden sm:block" />
              You will receive a confirmation once your payment is approved.
            </p>
          </div>

          {error && <p className="mt-4 rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>}

          <button
            onClick={submit}
            disabled={!data || accounts === null || accounts.length === 0}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-input bg-gradient-to-r from-accent to-accent-strong py-3.5 font-display text-base font-bold text-white shadow-[0_6px_24px_rgba(139,92,246,0.4)] transition hover:brightness-110 disabled:opacity-60"
          >
            {!data || accounts === null ? <Loader2 size={18} className="animate-spin" /> : null}
            Continue to Payment <ArrowRight size={18} />
          </button>
        </div>

        {/* Help sidebar */}
        <aside className="glass h-fit rounded-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-bold text-fg">Need Help?</h3>
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-accent">
              <Lock size={15} />
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-fg-2">
            If you face any issues with the payment process, our support team is here to help you.
          </p>
          <div className="mt-5 flex flex-col gap-4 border-t border-line pt-5">
            <div className="flex gap-3">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-fg-2" />
              <div>
                <p className="text-sm font-bold text-fg">100% Secure</p>
                <p className="text-xs text-fg-3">Your transactions are safe with us</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Clock size={18} className="mt-0.5 shrink-0 text-fg-2" />
              <div>
                <p className="text-sm font-bold text-fg">Quick Verification</p>
                <p className="text-xs text-fg-3">Payments are verified within 30 minutes</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-[10px] font-bold text-white">W</span>
              <div>
                <p className="text-sm font-bold text-fg">Chat on WhatsApp</p>
                <p className="text-xs text-fg-3">{pub?.['platform.whatsappNumber'] ?? '+92 300 1234567'}</p>
                <p className="text-xs text-fg-3">Available 10AM - 10PM</p>
              </div>
            </div>
          </div>
          <a
            href={`https://wa.me/${wa}`}
            target="_blank"
            rel="noreferrer"
            className="mt-5 flex items-center justify-center gap-2 rounded-input border border-success/40 py-2.5 text-sm font-bold text-success transition hover:bg-success/10"
          >
            Get Support on WhatsApp ↗
          </a>
        </aside>
      </div>

      <p className="mt-8 text-center text-xs text-fg-3">
        By adding money you agree to our <Link href="/legal/terms" className="text-accent hover:underline">Terms of Service</Link> and{' '}
        <Link href="/legal/privacy" className="text-accent hover:underline">Privacy Policy</Link>. Deposits never auto-credit — every payment is human-verified.
      </p>
    </div>
  );
}
