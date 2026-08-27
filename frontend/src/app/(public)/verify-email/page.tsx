'use client';
// Email confirmation landing — OPTIONAL track only. Accounts are ACTIVE from
// registration (no approval needed); confirming email just adds the verified
// badge and unlocks the admin-configured welcome bonus. Payments are verified
// by admins and are completely unrelated to this page.
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

function VerifyEmailInner() {
  const sp = useSearchParams();
  const token = sp.get('token');
  // The "missing token" branch is derived during render — no effect needed.
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState(
    token ? '' : 'This confirmation link is missing its token. Please use the link from your email.',
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch('/api/backend/auth/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.success) {
          setState('done');
        } else {
          setState('error');
          setMessage(j.message ?? 'This confirmation link is invalid or has expired.');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState('error');
        setMessage('Could not reach the server. Please try again.');
      });
    return () => { cancelled = true; };
  }, [token]);

  const view = !token ? 'error' : state;

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="glass animate-rise rounded-card px-6 py-10">
        {view === "working" && (
          <>
            <Loader2 size={32} className="mx-auto animate-spin text-accent" />
            <h1 className="mt-4 font-display text-xl font-bold text-fg">Confirming your email…</h1>
            <p className="mt-2 text-sm text-fg-2">Hang tight — this only takes a moment.</p>
          </>
        )}
        {view === "done" && (
          <>
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-success/30 bg-success/10 text-success">
              <CheckCircle2 size={26} />
            </span>
            <h1 className="mt-4 font-display text-xl font-bold text-fg">Email confirmed</h1>
            <p className="mt-2 text-sm text-fg-2">
              Your account shows the verified badge now. Your account was already active — enjoy the arena!
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center justify-center rounded-input bg-accent px-6 py-3 text-sm font-bold text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] transition hover:bg-accent-strong active:scale-[0.98]"
            >
              Sign In
            </Link>
          </>
        )}
        {view === "error" && (
          <>
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
              <XCircle size={26} />
            </span>
            <h1 className="mt-4 font-display text-xl font-bold text-fg">Link not working</h1>
            <p className="mt-2 text-sm text-fg-2">{message}</p>
            <p className="mt-1 text-xs text-fg-3">
              Don&apos;t worry — your account is already active. You can sign in without confirming.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center justify-center rounded-input border border-line px-6 py-3 text-sm font-semibold text-fg-2 transition hover:text-fg"
            >
              Go to Sign In
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>}>
      <VerifyEmailInner />
    </Suspense>
  );
}
