'use client';
// Send Money — user-to-user PKR transfer (atomic server-side transaction).
// Flow: form → confirmation → receipt. Double-submit is blocked by the busy
// guard AND the server-side idempotency key (requestId).
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2, Send, ShieldCheck } from 'lucide-react';
import { api, ApiClientError } from '@/lib/client-api';
import { fmt, fmtDate } from '@/lib/format';
import { Skeleton } from '@/components/ui';
import { useHasSession } from '@/lib/session';

interface WalletInfo {
  wallet: { balance?: number; withdrawable?: number; cashBalance: number; winningBalance: number };
}
interface TransferRow {
  id: string; amount: number; note: string | null; status: string; createdAt: string;
  senderUsername: string; recipientUsername: string;
}
interface TransferResult {
  transfer: TransferRow; replayed: boolean; currency: string;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

export default function TransferPage() {
  const router = useRouter();
  const hasSession = useHasSession();
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<{ sent: TransferRow[]; received: TransferRow[] } | null>(null);

  const [stage, setStage] = useState<'form' | 'confirm' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TransferResult | null>(null);

  useEffect(() => {
    if (!hasSession) return;
    api<WalletInfo>('/wallet')
      .then((o) => {
        setBalance(typeof o.wallet.balance === 'number' ? o.wallet.balance : Number(o.wallet.cashBalance) + Number(o.wallet.winningBalance));
      })
      .catch(() => {});
    api<{ sent: TransferRow[]; received: TransferRow[] }>('/wallet/transfers')
      .then((h) => setHistory(h))
      .catch(() => setHistory({ sent: [], received: [] }));
  }, [hasSession]);

  const parsedAmount = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [amount]);

  if (hasSession === null) {
    return (
      <div className="mx-auto max-w-2xl" aria-busy="true" aria-label="Loading transfer page">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-64" />
      </div>
    );
  }
  if (hasSession === false) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="font-display text-2xl font-bold text-fg">Sign in to send money</h1>
        <p className="mt-2 text-sm text-fg-2">Wallet transfers need a signed-in account.</p>
        <Link href="/login?next=/wallet/transfer" className="mt-6 inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white">
          Sign In
        </Link>
      </div>
    );
  }

  function submit() {
    if (busy) return;
    if (!recipient.trim()) return setError('Enter the recipient username.');
    if (parsedAmount === null) return setError('Enter a valid PKR amount.');
    setError(null);
    setStage('confirm');
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const reqId = uuid();
    try {
      const out = await api<TransferResult>('/wallet/transfers', {
        method: 'POST',
        body: { recipientUsername: recipient.trim(), amount: parsedAmount, note: note.trim(), requestId: reqId },
      });
      setReceipt(out);
      setBusy(false);
      setStage('done');
      setBalance((b) => (b === null || parsedAmount === null ? b : Math.round((b - parsedAmount) * 100) / 100));
      const fresh = await api<{ sent: TransferRow[]; received: TransferRow[] }>('/wallet/transfers').catch(() => null);
      if (fresh) setHistory(fresh);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        router.push('/login?next=/wallet/transfer');
        return;
      }
      setError(e instanceof ApiClientError ? (e.message ?? 'Transfer failed.') : 'Could not reach the server. Please try again.');
      setBusy(false);
      setStage('confirm');
    }
  }

  if (stage === 'done' && receipt) {
    return (
      <div className="mx-auto max-w-2xl">
        <Link href="/wallet" className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg-2 transition hover:text-accent">
          <ArrowLeft size={14} /> Back to wallet
        </Link>
        <div className="glass mt-4 rounded-card p-6 text-center sm:p-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-success/30 bg-success/10 text-success">
            <Check size={26} />
          </span>
          <h1 className="mt-4 font-display text-2xl font-bold text-fg">
            {receipt.replayed ? 'Transfer already processed' : 'Transfer complete'}
          </h1>
          <p className="mt-1 text-sm text-fg-2">
            {fmt(receipt.transfer.amount)} sent to <strong className="text-fg">@{receipt.transfer.recipientUsername}</strong>.
          </p>
          <dl className="mx-auto mt-6 max-w-sm space-y-2 rounded-card border border-line bg-base/50 p-5 text-left text-sm">
            <div className="flex justify-between"><dt className="text-fg-3">Transaction ID</dt><dd className="font-mono text-xs text-fg">{receipt.transfer.id}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-3">To</dt><dd className="font-semibold text-fg">@{receipt.transfer.recipientUsername}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-3">Amount</dt><dd className="tabular font-bold text-fg">{fmt(receipt.transfer.amount, 2)}</dd></div>
            {receipt.transfer.note && <div className="flex justify-between"><dt className="text-fg-3">Note</dt><dd className="text-fg">{receipt.transfer.note}</dd></div>}
            <div className="flex justify-between"><dt className="text-fg-3">When</dt><dd className="text-fg">{fmtDate(receipt.transfer.createdAt)}</dd></div>
          </dl>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-fg-3">
            <ShieldCheck size={13} className="text-success" /> Recorded in both wallets&apos; immutable ledgers.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Link href="/wallet" className="rounded-input bg-accent px-5 py-2.5 text-xs font-bold text-white">Back to Wallet</Link>
            <button
              onClick={() => { setStage('form'); setRecipient(''); setAmount(''); setNote(''); setReceipt(null); }}
              className="rounded-input border border-line px-5 py-2.5 text-xs font-semibold text-fg-2 hover:text-fg"
            >
              Send Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/wallet" className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg-2 transition hover:text-accent">
        <ArrowLeft size={14} /> Back to wallet
      </Link>
      <h1 className="mt-3 font-display text-2xl font-bold text-fg sm:text-3xl">Send Money</h1>
      <p className="mt-1 text-sm text-fg-2">
        Transfer PKR to another CLUTCHNEX player — instant, audited, secured.
        {balance !== null && <> Available: <strong className="text-fg">{fmt(balance)}</strong></>}
      </p>

      {stage === 'confirm' ? (
        <div className="glass mt-6 rounded-card p-6">
          <h2 className="font-display text-lg font-bold text-fg">Confirm Transfer</h2>
          <dl className="mt-4 space-y-3 rounded-card border border-line bg-base/50 p-5 text-sm">
            <div className="flex justify-between"><dt className="text-fg-3">Recipient</dt><dd className="font-bold text-fg">@{recipient.trim()}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-3">Amount</dt><dd className="tabular font-display text-xl font-bold text-accent">{fmt(parsedAmount ?? 0, 2)}</dd></div>
            {note.trim() && <div className="flex justify-between gap-4"><dt className="text-fg-3">Note</dt><dd className="text-right text-fg">{note.trim()}</dd></div>}
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-fg-3">
            Transfers are final and cannot be reversed. Double-check the username — money sent to the wrong player
            can only be recovered through{' '}
            <Link href="/support" className="font-semibold text-accent">support</Link>.
          </p>
          {error && <p role="alert" className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs font-medium text-danger">{error}</p>}
          <div className="mt-5 flex gap-2">
            <button
              onClick={confirm}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-input bg-accent px-4 py-3 text-sm font-bold text-white transition hover:bg-accent-strong disabled:opacity-60"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {busy ? 'Sending…' : `Confirm — send ${fmt(parsedAmount ?? 0)}`}
            </button>
            <button onClick={() => setStage('form')} disabled={busy} className="rounded-input border border-line px-4 text-sm font-semibold text-fg-2 hover:text-fg">
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="glass mt-6 rounded-card p-6">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-3">Recipient username</span>
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
              placeholder="e.g. hamza_sniper"
              autoComplete="off"
              className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-3 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent"
            />
          </label>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-3">Amount (PKR)</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0"
              inputMode="decimal"
              className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-3 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent"
            />
          </label>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-3">Note (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What is this for?"
              maxLength={140}
              className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-3 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent"
            />
          </label>
          {error && <p role="alert" className="mt-3 rounded-input border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs font-medium text-danger">{error}</p>}
          <button
            onClick={submit}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-input bg-accent px-4 py-3.5 text-sm font-bold text-white shadow-[0_0_28px_rgba(139,92,246,0.4)] transition hover:bg-accent-strong"
          >
            Continue <ArrowRight size={15} />
          </button>
        </div>
      )}

      {/* History */}
      {history && (history.sent.length > 0 || history.received.length > 0) && (
        <section className="glass mt-6 rounded-card p-5">
          <h2 className="font-display text-base font-bold text-fg">Transfer History</h2>
          <div className="mt-3 flex flex-col divide-y divide-line/60">
            {[...history.sent.map((t) => ({ ...t, dir: 'SENT' as const })), ...history.received.map((t) => ({ ...t, dir: 'RECEIVED' as const }))]
              .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
              .slice(0, 10)
              .map((t) => (
                <div key={`${t.dir}-${t.id}`} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-fg">
                      {t.dir === 'SENT' ? `→ @${t.recipientUsername}` : `← @${t.senderUsername}`}
                      {t.note && <span className="ml-2 text-xs font-normal text-fg-3">“{t.note}”</span>}
                    </p>
                    <p className="text-[11px] text-fg-3">{fmtDate(t.createdAt)} · {t.id.slice(-6)}</p>
                  </div>
                  <span className={`tabular shrink-0 text-sm font-bold ${t.dir === 'SENT' ? 'text-danger' : 'text-success'}`}>
                    {t.dir === 'SENT' ? '−' : '+'}{fmt(t.amount, 2)}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
