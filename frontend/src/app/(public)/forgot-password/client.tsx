'use client';
// Password reset request — the self-service "Forgot password?" flow.
// The API returns a constant-shape response (never reveals whether the
// account exists), so the success screen stays neutral too.
import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';

function ForgotPasswordInner() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const fd = new FormData(e.currentTarget);
    const value = String(fd.get('email') ?? '');

    try {
      const res = await fetch('/api/backend/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: value }),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.message ?? 'Something went wrong. Please try again.');
        return;
      }

      // Development only: the API echoes the token so the flow is testable
      // without a mail provider. Never shown in production responses.
      setDevToken(json.data?.resetTokenDevOnly ?? null);
      setEmail(value);
      setSent(true);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="glass animate-rise rounded-card px-6 py-10 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-success/30 bg-success/10 text-success">
          <CheckCircle2 size={26} />
        </span>
        <h1 className="mt-4 font-display text-xl font-bold text-fg">Check your inbox</h1>
        <p className="mt-2 text-sm text-fg-2">
          If an account exists for <span className="font-semibold text-fg">{email}</span>, a
          password reset link is on its way. It expires after a short while — and using it signs
          you out of every other device for safety.
        </p>
        <p className="mt-2 text-xs text-fg-3">
          Nothing landed? Check your spam folder, or{' '}
          <Link href="/support" className="font-semibold text-accent hover:text-accent-strong">
            contact support
          </Link>{' '}
          for a manual reset.
        </p>
        {devToken && (
          <p className="mt-4 rounded-input border border-line bg-white/[3%] px-4 py-3 text-xs text-fg-3">
            Dev mode (no mail provider) — use this reset link:{' '}
            <Link
              href={`/reset-password?token=${encodeURIComponent(devToken)}`}
              className="break-all font-semibold text-accent hover:text-accent-strong"
            >
              Set new password
            </Link>
          </p>
        )}
        <Link
          href="/login"
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-input border border-line px-6 py-3 text-sm font-semibold text-fg-2 transition hover:text-fg"
        >
          <ArrowLeft size={15} /> Back to Sign In
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="glass animate-rise rounded-card px-6 py-8 sm:p-10">
      <h1 className="font-display text-xl font-bold text-fg">Reset your password</h1>
      <p className="mt-2 text-sm text-fg-2">
        Enter the email you signed up with and we&apos;ll send you a secure link to choose a new
        password.
      </p>

      <div className="mt-6">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-3">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent focus:shadow-[0_0_0_3px_rgba(139,92,246,0.15)]"
          />
        </label>
        <p className="mt-2 text-[11px] text-fg-3">
          Tip: the reset link is sent to the email address on your account.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-input bg-accent px-4 py-3 text-sm font-bold text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] transition duration-200 hover:bg-accent-strong hover:shadow-[0_0_28px_rgba(139,92,246,0.5)] active:scale-[0.98] disabled:opacity-60"
      >
        {loading && <Loader2 size={15} className="animate-spin" />}
        Send reset link
      </button>

      <Link
        href="/login"
        className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold text-fg-3 transition hover:text-fg"
      >
        <ArrowLeft size={14} /> Back to Sign In
      </Link>
    </form>
  );
}

export function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={<div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>}
    >
      <div className="mx-auto max-w-md px-4 py-16">
        <ForgotPasswordInner />
      </div>
    </Suspense>
  );
}
