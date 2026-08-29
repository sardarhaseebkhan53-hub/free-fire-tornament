'use client';
// Set a new password — reached from the reset link in the email
// (/reset-password?token=...). The token is single-use: on success every
// active session for the account is revoked.
import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

type View = 'form' | 'working' | 'done' | 'error';

function ResetPasswordInner() {
  const sp = useSearchParams();
  const token = sp.get('token');
  const hasToken = Boolean(token);

  const [view, setView] = useState<View>(hasToken ? 'form' : 'error');
  const [message, setMessage] = useState(
    hasToken ? '' : 'This reset link is missing its token. Please use the full link from your email.',
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const err = (name: string) =>
    fieldErrors[name] ? <span className="mt-1 block text-[11px] font-medium text-danger">{fieldErrors[name]}</span> : null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldErrors({});
    setLoading(true);
    setView('working');

    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries()) as Record<string, string>;

    try {
      const res = await fetch('/api/backend/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, ...body }),
      });
      const json = await res.json();

      if (!json.success) {
        if (json.code === 'VALIDATION_ERROR' && Array.isArray(json.errors)) {
          const fe: Record<string, string> = {};
          for (const err of json.errors) fe[err.path] = err.message;
          setFieldErrors(fe);
          setView('form');
        } else {
          setMessage(json.message ?? 'This reset link is invalid or has expired.');
          setView('error');
        }
        return;
      }
      setView('done');
    } catch {
      setMessage('Could not reach the server. Please try again.');
      setView('error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass animate-rise rounded-card px-6 py-10">
      {view === 'form' && (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="text-center">
            <h1 className="font-display text-xl font-bold text-fg">Choose a new password</h1>
            <p className="mt-2 text-sm text-fg-2">
              Pick something you don&apos;t use anywhere else. After saving, you&apos;ll be signed
              out of all devices.
            </p>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-3">New Password</span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              placeholder="••••••••"
              autoComplete="new-password"
              className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent focus:shadow-[0_0_0_3px_rgba(139,92,246,0.15)]"
            />
            <span className="mt-1 block text-[11px] text-fg-3">At least 8 characters, with a letter and a number.</span>
          </label>
          {err('password')}

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-3">Confirm New Password</span>
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              placeholder="••••••••"
              autoComplete="new-password"
              className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent focus:shadow-[0_0_0_3px_rgba(139,92,246,0.15)]"
            />
          </label>
          {err('confirmPassword')}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-input bg-accent px-4 py-3 text-sm font-bold text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] transition duration-200 hover:bg-accent-strong hover:shadow-[0_0_28px_rgba(139,92,246,0.5)] active:scale-[0.98] disabled:opacity-60"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            Update Password
          </button>
        </form>
      )}

      {view === 'working' && (
        <div className="text-center">
          <Loader2 size={32} className="mx-auto animate-spin text-accent" />
          <h1 className="mt-4 font-display text-xl font-bold text-fg">Updating your password…</h1>
          <p className="mt-2 text-sm text-fg-2">Hang tight — this only takes a moment.</p>
        </div>
      )}

      {view === 'done' && (
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-success/30 bg-success/10 text-success">
            <CheckCircle2 size={26} />
          </span>
          <h1 className="mt-4 font-display text-xl font-bold text-fg">Password updated</h1>
          <p className="mt-2 text-sm text-fg-2">
            You&apos;re all set — sign in with your new password. Any other signed-in devices were
            signed out for your safety.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center justify-center rounded-input bg-accent px-6 py-3 text-sm font-bold text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] transition hover:bg-accent-strong active:scale-[0.98]"
          >
            Sign In
          </Link>
        </div>
      )}

      {view === 'error' && (
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
            <XCircle size={26} />
          </span>
          <h1 className="mt-4 font-display text-xl font-bold text-fg">Link not working</h1>
          <p className="mt-2 text-sm text-fg-2">{message}</p>
          <p className="mt-1 text-xs text-fg-3">
            Reset links are single-use and expire quickly. Request a fresh one and try again.
          </p>
          <Link
            href="/forgot-password"
            className="mt-6 inline-flex items-center justify-center rounded-input bg-accent px-6 py-3 text-sm font-bold text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] transition hover:bg-accent-strong active:scale-[0.98]"
          >
            Request a new link
          </Link>
        </div>
      )}
    </div>
  );
}

export function ResetPasswordPage() {
  return (
    <Suspense
      fallback={<div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>}
    >
      <div className="mx-auto max-w-md px-4 py-16">
        <ResetPasswordInner />
      </div>
    </Suspense>
  );
}
