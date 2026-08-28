'use client';
// Submit Payment Proof — design 16. Payment instructions (account details, QR)
// + the manual verification form (TID, sender, screenshot) + status timeline.
// Deposits are NEVER auto-credited: they land as PENDING for human review.
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, CheckCircle2, CircleDollarSign, Clock3, CreditCard, FileCheck2,
  Loader2, Lock, ShieldCheck, Upload, User as UserIcon, X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { api, ApiClientError, getToken } from '@/lib/client-api';
import { WhatsAppHelp } from '@/components/whatsapp-help';
import { MethodBrand, METHOD_LABEL, type Method } from '@/components/wallet/bits';
import { CopyChip } from '@/components/wallet/bits';
import { fmt } from '@/lib/format';

interface Account {
  id: string; method: Method; label: string; accountName: string;
  accountNumber: string; extra: { bank?: string; branch?: string } | null; instructions: string | null;
}

const STEPS = [
  { n: 1, title: 'Submitted', body: 'We receive your payment proof submission.', icon: FileCheck2, tone: 'text-accent border-accent/40 bg-accent/10' },
  { n: 2, title: 'Pending Review', body: 'Our team verifies your payment manually.', icon: Clock3, tone: 'text-warning border-warning/40 bg-warning/10' },
  { n: 3, title: 'Approved', body: 'Payment is approved after successful verification.', icon: ShieldCheck, tone: 'text-info border-info/40 bg-info/10' },
  { n: 4, title: 'Balance Credited', body: 'PKR is added to your CLUTCHNEX wallet.', icon: CheckCircle2, tone: 'text-success border-success/40 bg-success/10' },
];

function PaymentInner() {
  const params = useSearchParams();
  const router = useRouter();
  const amount = Number(params.get('amount') || 0);
  const method = (params.get('method') || 'JAZZCASH') as Method;

  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [tid, setTid] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderAccount, setSenderAccount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!getToken()) { router.replace('/login?next=/wallet'); return; }
    if (!amount || !['JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER', 'NAYAPAY', 'SADAPAY'].includes(method)) {
      router.replace('/wallet/add-money');
      return;
    }
    api<{ accounts: Account[] }>('/wallet/payment-accounts')
      .then((d) => setAccount(d.accounts.find((a) => a.method === method) ?? d.accounts[0] ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [amount, method, router]);

  useEffect(() => {
    if (account && qrRef.current) {
      QRCode.toCanvas(qrRef.current, `${account.label} • ${account.accountName} • ${account.accountNumber}`, {
        width: 148, margin: 1, color: { dark: '#070A14', light: '#FFFFFF' },
      }).catch(() => {});
    }
  }, [account]);

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
      setError('Screenshot must be a JPG, PNG or WebP image.');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError('Screenshot must be under 5MB.');
      return;
    }
    setError(null);
    setFile(f);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const form = new FormData();
      form.append('amount', String(amount));
      form.append('method', method);
      form.append('transactionId', tid.trim());
      form.append('senderName', senderName.trim());
      form.append('senderAccount', senderAccount.trim());
      if (file) form.append('screenshot', file);
      await api('/wallet/deposits', { method: 'POST', form });
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(e.message);
        setFieldErrors(e.fieldErrors ?? {});
      } else {
        setError('Could not submit the payment. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/wallet/add-money" className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-input border border-line text-fg-2 transition hover:text-fg" aria-label="Back">
        <ArrowLeft size={16} />
      </Link>
      <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">Submit Payment Proof</h1>
      <div className="mt-2 h-1 w-16 rounded-pill bg-accent" />

      {done ? (
        /* ---------- Success state ---------- */
        <div className="glass mx-auto mt-10 max-w-xl rounded-card p-10 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success">
            <CheckCircle2 size={34} />
          </span>
          <h2 className="mt-5 font-display text-xl font-bold text-fg">Payment submitted for verification</h2>
          <p className="mt-2 text-sm text-fg-2">
            Your {fmt(amount)} {METHOD_LABEL[method]} payment
            (TID <span className="font-mono text-fg">{tid}</span>) is now <span className="font-semibold text-warning">pending review</span>.
            Balances update within 30 minutes of approval — you will get a notification.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/wallet/transactions" className="rounded-input bg-accent px-5 py-2.5 text-sm font-bold text-white">View Transactions</Link>
            <Link href="/wallet" className="rounded-input border border-line px-5 py-2.5 text-sm font-bold text-fg">Back to Wallet</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {/* ---------- 1. Payment instructions ---------- */}
            <section className="glass rounded-card p-5 sm:p-6">
              <h2 className="flex items-center gap-2.5 font-display text-base font-bold text-fg">
                <span className="flex h-8 w-8 items-center justify-center rounded-input border border-line text-accent"><CreditCard size={15} /></span>
                1. Payment Instructions
              </h2>

              <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-fg-3">Selected Payment Method</p>
              <div className="mt-2 flex items-center gap-3 rounded-input border border-accent/60 bg-accent/[6%] px-4 py-3">
                <MethodBrand method={method} size={34} />
                <span className="font-display text-base font-bold text-fg">{METHOD_LABEL[method]}</span>
                <span className="ml-auto rounded-pill border border-accent/30 bg-accent/15 px-2.5 py-0.5 text-[11px] font-semibold text-accent">Recommended</span>
              </div>

              <p className="mt-5 border-b border-line pb-2 text-sm font-bold text-accent">Account Details</p>
              <div className="mt-3 flex flex-col gap-2.5">
                {[
                  { icon: UserIcon, label: 'Account Title', value: account?.accountName ?? '—' },
                  { icon: CreditCard, label: 'Account Number', value: account?.accountNumber ?? '—' },
                  { icon: CircleDollarSign, label: 'Amount to Send', value: fmt(amount) },
                ].map((row) => {
                  const Icon = row.icon;
                  return (
                    <div key={row.label} className="flex items-center gap-3 rounded-input border border-line bg-white/[2%] px-3.5 py-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"><Icon size={14} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-fg-3">{row.label}</p>
                        <p className={`truncate text-sm font-bold ${row.label === 'Amount to Send' ? 'text-success' : 'text-fg'}`}>{row.value}</p>
                      </div>
                      <CopyChip value={row.value} />
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 text-center">
                <p className="text-xs text-fg-2">Scan to Pay with <span className="font-semibold text-accent">{METHOD_LABEL[method]}</span></p>
                <div className="mx-auto mt-3 w-fit rounded-card bg-white p-2.5">
                  <canvas ref={qrRef} width={148} height={148} className="block" />
                </div>
                <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-fg-3">
                  <span className="text-info">ⓘ</span> Make sure to send the exact amount shown above.
                </p>
                {account?.instructions && <p className="mx-auto mt-2 max-w-xs text-[11px] leading-relaxed text-fg-3">{account.instructions}</p>}
              </div>
            </section>

            {/* ---------- 2. Submit payment details ---------- */}
            <section className="glass rounded-card p-5 sm:p-6">
              <h2 className="flex items-center gap-2.5 font-display text-base font-bold text-fg">
                <span className="flex h-8 w-8 items-center justify-center rounded-input border border-line text-accent"><FileCheck2 size={15} /></span>
                2. Submit Payment Details
              </h2>

              <div className="mt-5 flex flex-col gap-4">
                {[
                  { label: 'Transaction ID / Reference ID', ph: 'Enter Transaction ID', value: tid, set: setTid, err: fieldErrors.transactionId, helper: 'Enter the Transaction ID / Reference ID from your payment.' },
                  { label: 'Sender Name', ph: 'Enter Sender Name', value: senderName, set: setSenderName, err: fieldErrors.senderName, helper: 'Enter the name used to send the payment.' },
                  { label: 'Sender Account Number', ph: 'Enter Sender Account Number', value: senderAccount, set: setSenderAccount, err: fieldErrors.senderAccount, helper: 'Enter your account number or mobile number.' },
                ].map((f) => (
                  <label key={f.label} className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-fg-2">
                      {f.label} <span className="text-danger">*</span>
                    </span>
                    <input
                      value={f.value}
                      onChange={(e) => f.set(e.target.value)}
                      placeholder={f.ph}
                      className={`w-full rounded-input border bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent ${f.err ? 'border-danger/60' : 'border-line'}`}
                    />
                    <span className="mt-1 block text-[11px] text-fg-3">{f.err ?? f.helper}</span>
                  </label>
                ))}

                <div>
                  <p className="mb-1.5 text-xs font-semibold text-fg-2">Payment Screenshot <span className="text-danger">*</span></p>
                  <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
                  {!file ? (
                    <button
                      type="button"
                      onClick={() => inputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
                      className={`flex w-full flex-col items-center gap-2 rounded-card border-2 border-dashed px-4 py-9 text-center transition ${
                        dragOver ? 'border-accent bg-accent/[8%]' : 'border-accent/40 bg-accent/[3%] hover:border-accent/70'
                      }`}
                    >
                      <Upload size={26} className="text-accent" />
                      <span className="text-sm font-semibold text-fg">Drop screenshot here or <span className="text-accent underline">browse</span></span>
                      <span className="text-[11px] text-fg-3">(JPG/PNG, max 5MB)</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 rounded-input border border-success/30 bg-success/[6%] p-2.5">
                      <span className="flex h-10 w-14 items-center justify-center rounded-input bg-success/15 text-[9px] font-bold uppercase text-success">IMG</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-fg">{file.name}</p>
                        <p className="text-[11px] text-fg-3">{(file.size / 1024).toFixed(0)} KB</p>
                      </div>
                      <button onClick={() => setFile(null)} className="flex h-8 w-8 items-center justify-center rounded-input border border-line text-fg-3 transition hover:border-danger/40 hover:text-danger" aria-label="Remove file">
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  {fieldErrors.screenshot && <p className="mt-1 text-[11px] text-danger">{fieldErrors.screenshot}</p>}
                </div>
              </div>

              {error && <p className="mt-4 rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>}

              <button
                onClick={submit}
                disabled={submitting || !tid.trim() || !senderName.trim() || !file}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-input bg-gradient-to-r from-accent to-accent-strong py-3.5 font-display text-base font-bold text-white shadow-[0_6px_24px_rgba(139,92,246,0.4)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                Submit for Verification
              </button>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-fg-3">
                <Lock size={11} /> Your payment details are secure and encrypted.
              </p>
            </section>
          </div>

          {/* ---------- 3. Verification status timeline ---------- */}
          <section className="glass mt-5 rounded-card p-5 sm:p-6">
            <h2 className="font-display text-base font-bold text-fg">
              3. Verification Status <span className="font-normal text-fg-3">– What Happens Next?</span>
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div key={step.n} className="relative flex items-start gap-3">
                    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 ${step.tone}`}>
                      <Icon size={20} />
                    </span>
                    <div>
                      <p className="text-sm font-bold text-fg"><span className="mr-1.5 text-fg-3">{step.n}.</span>{step.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-fg-3">{step.body}</p>
                    </div>
                    {i < STEPS.length - 1 && (
                      <span className="absolute right-[-14px] top-6 hidden border-t-2 border-dashed border-line lg:block lg:w-6" aria-hidden />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="mt-5 rounded-card border border-danger/25 bg-danger/[5%] px-5 py-4 text-center">
            <p className="text-sm text-fg-2">
              <span className="font-bold text-danger">Important:</span> Deposits are verified manually, never auto-approved.
            </p>
          </div>

          <WhatsAppHelp />
        </>
      )}
    </div>
  );
}

export default function PaymentPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>}>
      <PaymentInner />
    </Suspense>
  );
}
