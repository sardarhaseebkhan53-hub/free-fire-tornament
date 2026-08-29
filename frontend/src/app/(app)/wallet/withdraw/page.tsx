'use client';
// Withdraw Winnings — design 22. Winning balance only (server-enforced),
// admin approval chain: PENDING → APPROVED → PROCESSING → PAID.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, CheckCircle2, Clock3, Loader2, Lock, Phone, ShieldAlert,
  ShieldCheck, User as UserIcon, Landmark, Wallet as WalletIcon,
} from 'lucide-react';
import { api } from '@/lib/client-api';
import { deferLoad, useHasSession } from '@/lib/session';
import { MethodBrand, METHOD_LABEL, StatusPill, type Method } from '@/components/wallet/bits';
import { fmt } from '@/lib/format';

interface Withdrawal {
  id: string; amount: number; method: Method; methodLabel: string;
  accountName: string; accountMasked: string; status: string;
  adminNote: string | null; paidReference: string | null; createdAt: string;
}
interface Overview {
  wallet: { winningBalance: number };
  settings: { minWithdrawal: number; withdrawalFeePercent: number };
}
interface PubSettings { 'platform.whatsappNumber'?: string }

const METHODS: Array<{ id: Method; label: string; sub?: string }> = [
  { id: 'JAZZCASH', label: 'JazzCash' },
  { id: 'EASYPAISA', label: 'EasyPaisa' },
  { id: 'NAYAPAY', label: 'NayaPay' },
  { id: 'SADAPAY', label: 'SadaPay' },
  { id: 'BANK_TRANSFER', label: 'Bank Transfer', sub: 'Direct to Bank' },
];

export default function WithdrawPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [recent, setRecent] = useState<Withdrawal[]>([]);
  const [pub, setPub] = useState<PubSettings | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('JAZZCASH');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const withdrawalRequestId = useRef<string | null>(null);
  const hasSession = useHasSession();
  const anon = hasSession === false;

  async function refresh() {
    const [o, w] = await Promise.all([
      api<Overview>('/wallet'),
      api<{ items: Withdrawal[] }>('/wallet/withdrawals?pageSize=5'),
    ]);
    setOverview(o);
    setRecent(w.items);
  }

  useEffect(() => {
    if (!hasSession) return;
    deferLoad(() => refresh().catch(() => {}));
    fetch('/api/backend/public/settings/public').then((r) => r.json()).then((j) => setPub(j.data)).catch(() => {});
  }, [hasSession]);

  if (anon) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="font-display text-2xl font-bold text-fg">Sign in to withdraw winnings</h1>
        <Link href="/login?next=/wallet/withdraw" className="mt-6 inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white">Sign In</Link>
      </div>
    );
  }

  const winning = overview?.wallet.winningBalance ?? 0;
  const min = overview?.settings.minWithdrawal ?? 100;
  const feePct = overview?.settings.withdrawalFeePercent ?? 0;
  const amt = Number(amount || 0);
  const wa = (pub?.['platform.whatsappNumber'] ?? '+923001234567').replace(/[^\d]/g, '');

  async function submit() {
    setError(null);
    if (!Number.isInteger(amt) || amt < min) return setError(`Minimum withdrawal is ${fmt(min)}.`);
    if (amt > winning) return setError('Amount exceeds your available winning balance.');
    if (accountName.trim().length < 2) return setError('Enter the account holder name.');
    const acc = accountNumber.replace(/[\s-]/g, '');
    if (['JAZZCASH', 'EASYPAISA', 'NAYAPAY', 'SADAPAY'].includes(method) && !/^03\d{9}$/.test(acc)) {
      return setError(`Enter a valid ${METHOD_LABEL[method]} mobile number (03XXXXXXXXX).`);
    }
    if (method === 'BANK_TRANSFER' && !/^[A-Za-z0-9]{8,34}$/.test(acc)) {
      return setError('Enter a valid account number or IBAN.');
    }
    setSubmitting(true);
    withdrawalRequestId.current ??= crypto.randomUUID();
    try {
      const out = await api<{ withdrawal: Withdrawal }>('/wallet/withdrawals', {
        method: 'POST',
        body: {
          amount: amt, method,
          accountName: accountName.trim(),
          accountNumber: accountNumber.trim(),
          accountDetails: phone.trim() ? `Linked phone: ${phone.trim()}` : '',
          requestId: withdrawalRequestId.current!,
        },
      });
      setDone(out.withdrawal.amount);
      withdrawalRequestId.current = null;
      setAmount('');
      await refresh();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Withdrawal request failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center gap-3">
        <Link href="/wallet" className="flex h-8 w-8 items-center justify-center rounded-input border border-line text-fg-2 transition hover:text-fg" aria-label="Back">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">Withdraw Winnings</h1>
      </div>

      {/* Hero */}
      <div className="relative mt-6 overflow-hidden rounded-card border border-line bg-surface px-5 py-6 sm:px-8">
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-70"
          style={{ background: 'radial-gradient(50% 90% at 80% 30%, rgba(245,185,66,0.18), transparent 70%), radial-gradient(40% 70% at 95% 90%, rgba(139,92,246,0.15), transparent 70%)' }}
          aria-hidden
        />
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fg-2">Available for withdrawal</p>
        <p className="tabular mt-1 font-display text-4xl font-bold text-reward sm:text-5xl">{fmt(winning)}</p>
        <p className="mt-4 flex items-center gap-2 rounded-input border border-line bg-base/60 px-3.5 py-2.5 text-xs text-fg-2 sm:inline-flex">
          <span className="text-info">ⓘ</span> Winnings only — deposited PKR is not withdrawable.
        </p>
        <span className="absolute right-8 top-1/2 hidden -translate-y-1/2 sm:block" aria-hidden>
          <span className="flex h-20 w-20 items-center justify-center rounded-2xl border border-reward/30 bg-reward/10 text-reward shadow-[0_0_40px_rgba(245,185,66,0.25)]">
            <WalletIcon size={36} />
          </span>
        </span>
      </div>

      {done !== null && (
        <div className="mt-4 flex items-center gap-3 rounded-card border border-success/30 bg-success/[7%] px-5 py-4">
          <CheckCircle2 size={20} className="shrink-0 text-success" />
          <p className="text-sm text-fg-2">
            <span className="font-bold text-success">Withdrawal of {fmt(done)} requested.</span>{' '}
            It is now <StatusPillInline /> — follow the progress below or in your notifications.
          </p>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_270px_300px]">
        {/* ---- Form column ---- */}
        <div className="glass rounded-card p-5 sm:p-6">
          <h2 className="font-display text-base font-bold text-fg">1. Enter Withdrawal Amount</h2>
          <div className="mt-3 flex items-center rounded-input border border-line bg-white/[3%] pr-2 transition focus-within:border-accent">
            <span className="pl-4 font-display text-lg text-accent">PKR </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder="Enter amount"
              aria-label="Withdrawal amount"
              className="w-full bg-transparent px-3 py-3 text-base font-semibold text-fg outline-none placeholder:text-fg-3"
            />
            <button
              onClick={() => setAmount(String(Math.floor(winning)))}
              className="rounded-pill border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-bold text-accent"
            >
              MAX
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-fg-3">Quick Amount</span>
            {[500, 1000].map((q) => (
              <button
                key={q}
                onClick={() => setAmount(String(q))}
                className="rounded-pill border border-line bg-white/[2%] px-4 py-1.5 text-xs font-semibold text-fg-2 transition hover:border-accent/40 hover:text-fg"
              >
                PKR {q.toLocaleString('en-PK')}
              </button>
            ))}
          </div>

          <h2 className="mt-6 font-display text-base font-bold text-fg">2. Select Withdrawal Method</h2>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {METHODS.map((m) => {
              const active = method === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className={`flex flex-col items-center gap-2 rounded-card border px-2 py-3.5 transition ${
                    active ? 'border-accent bg-accent/[7%] shadow-[0_0_0_3px_rgba(139,92,246,0.12)]' : 'border-line bg-white/[2%] hover:border-fg-3/40'
                  }`}
                >
                  <MethodBrand method={m.id} size={34} />
                  <span className="text-center text-[11px] font-bold leading-tight text-fg">
                    {m.label}
                    {m.sub && <span className="block font-normal text-fg-3">{m.sub}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          <h2 className="mt-6 font-display text-base font-bold text-fg">3. Account Details</h2>
          <div className="mt-3 flex flex-col gap-3">
            {[
              { icon: UserIcon, ph: 'Account Holder Name', value: accountName, set: setAccountName },
              { icon: Landmark, ph: method === 'BANK_TRANSFER' ? 'Account Number / IBAN' : 'Account Number (03XXXXXXXXX)', value: accountNumber, set: setAccountNumber },
              { icon: Phone, ph: 'Phone Number (Linked with Account)', value: phone, set: setPhone },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <label key={f.ph} className="flex items-center gap-3 rounded-input border border-line bg-white/[3%] px-3.5 transition focus-within:border-accent">
                  <Icon size={15} className="shrink-0 text-fg-3" />
                  <input
                    value={f.value}
                    onChange={(e) => f.set(e.target.value)}
                    placeholder={f.ph}
                    className="w-full bg-transparent py-3 text-sm text-fg outline-none placeholder:text-fg-3"
                  />
                </label>
              );
            })}
          </div>

          {error && <p className="mt-4 rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-input bg-gradient-to-r from-accent to-accent-strong py-3.5 font-display text-base font-bold text-white shadow-[0_6px_24px_rgba(139,92,246,0.4)] transition hover:brightness-110 disabled:opacity-60"
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <Lock size={16} />}
            Request Withdrawal
          </button>
          <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] text-fg-3">
            <Lock size={10} /> Admin approval required{feePct > 0 ? ` · processing fee ${feePct}%` : ' · no processing fee'}
          </p>
        </div>

        {/* ---- Info column ---- */}
        <div className="flex flex-col gap-4">
          {[
            { icon: WalletIcon, title: 'Minimum Withdrawal', value: fmt(min), tone: 'border-line' },
            { icon: Clock3, title: 'Processing Time', value: '24 – 48 hours', tone: 'border-line' },
            { icon: ShieldCheck, title: 'Review Required', value: 'All withdrawals are reviewed by our team for security.', tone: 'border-line', small: true },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.title} className={`rounded-card border ${c.tone} bg-white/[2%] p-4`}>
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-base/60 text-accent"><Icon size={15} /></span>
                  <div>
                    <p className="text-xs text-fg-2">{c.title}</p>
                    {c.small
                      ? <p className="text-xs font-semibold leading-snug text-fg">{c.value}</p>
                      : <p className="font-display text-lg font-bold text-fg">{c.value}</p>}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="rounded-card border border-accent/25 bg-accent/[5%] p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-accent">
              <ShieldAlert size={15} /> Important Note
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-fg-2">
              You can only withdraw your winnings. Deposited PKR is non-withdrawable.
            </p>
          </div>
        </div>

        {/* ---- Recent withdrawals + help ---- */}
        <div className="flex flex-col gap-4">
          <div className="glass rounded-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-bold text-fg">Recent Withdrawals</h2>
              <Link href="/wallet/transactions" className="text-xs font-semibold text-accent hover:underline">View All</Link>
            </div>
            <div className="mt-3 flex flex-col gap-2.5">
              {recent.length === 0 && <p className="py-4 text-center text-xs text-fg-3">No withdrawals yet.</p>}
              {recent.map((wd) => (
                <div key={wd.id} className="flex items-center gap-3 rounded-input border border-line bg-white/[2%] p-2.5">
                  <MethodBrand method={wd.method} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-fg">To {wd.methodLabel}</p>
                    <p className="truncate text-[10px] text-fg-3">{wd.accountMasked}</p>
                    <p className="text-[10px] text-fg-3">
                      {new Date(wd.createdAt).toLocaleString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-xs font-bold text-fg">{fmt(wd.amount)}</p>
                    <div className="mt-0.5"><StatusPill status={wd.status} /></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-card border border-success/25 bg-success/[4%] p-5 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366]/15 text-[#25D366]">
              <Phone size={24} />
            </span>
            <p className="mt-3 font-display text-base font-bold text-fg">Need Help?</p>
            <p className="mt-1 text-xs text-fg-2">Our support team is here to assist you with any withdrawal issues.</p>
            <a
              href={`https://wa.me/${wa}`}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex items-center justify-center gap-2 rounded-input border border-success/40 py-2.5 text-sm font-bold text-success transition hover:bg-success/10"
            >
              Chat on WhatsApp
            </a>
            <p className="mt-3 text-[11px] text-fg-3">✓ Official Support • Fast Response</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPillInline() {
  return <span className="font-semibold text-warning">pending review</span>;
}
