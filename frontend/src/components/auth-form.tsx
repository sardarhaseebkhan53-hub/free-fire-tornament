'use client';
// Login + Register forms against the backend proxy. All validation is
// server-side; this component only displays the API's verdict.
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent, Suspense } from 'react';
import { Loader2 } from 'lucide-react';

function Field({
  label, name, type = 'text', placeholder, required = true, hint,
}: {
  label: string; name: string; type?: string; placeholder?: string; required?: boolean; hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-3">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete={type === 'password' ? 'current-password' : undefined}
        className="w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent focus:shadow-[0_0_0_3px_rgba(139,92,246,0.15)]"
      />
      {hint && <span className="mt-1 block text-[11px] text-fg-3">{hint}</span>}
    </label>
  );
}

function AuthFormInner({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);

    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries()) as Record<string, string>;

    try {
      const res = await fetch(`/api/backend/auth/${mode}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (!json.success) {
        if (json.code === 'VALIDATION_ERROR' && Array.isArray(json.errors)) {
          const fe: Record<string, string> = {};
          for (const err of json.errors) fe[err.path] = err.message;
          setFieldErrors(fe);
        }
        setError(json.message ?? 'Something went wrong.');
        return;
      }

      if (mode === 'login') {
        localStorage.setItem('cn_access', json.data.accessToken);
        window.dispatchEvent(new Event('storage'));
        router.push(search.get('next') ?? '/dashboard');
      } else {
        setVerifyNotice(
          `Account created! We sent a verification link to ${body.email}. Verify it to unlock your welcome bonus.`,
        );
        (e.target as HTMLFormElement).reset();
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const err = (name: string) =>
    fieldErrors[name] ? <span className="mt-1 block text-[11px] font-medium text-danger">{fieldErrors[name]}</span> : null;

  if (verifyNotice) {
    return (
      <div className="rounded-input border border-success/30 bg-success/10 px-4 py-4 text-sm text-success">
        {verifyNotice}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
      {mode === 'register' && (
        <>
          <div><Field label="Full Name" name="fullName" placeholder="Your name" />{err('fullName')}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Field label="Username" name="username" placeholder="clutch_player" />{err('username')}</div>
            <div><Field label="Phone" name="phone" placeholder="+92 3xx xxxxxxx" required={false} />{err('phone')}</div>
          </div>
          <div><Field label="Email" name="email" type="email" placeholder="you@example.com" />{err('email')}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Field label="Free Fire UID" name="freeFireUID" placeholder="5231879640" required={false} hint="6–12 digits from your profile" />
              {err('freeFireUID')}
            </div>
            <div><Field label="Free Fire IGN" name="freeFireIGN" placeholder="Your in-game name" required={false} />{err('freeFireIGN')}</div>
          </div>
        </>
      )}

      {mode === 'login' && (
        <div><Field label="Email or Username" name="identifier" placeholder="you@example.com" /></div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div><Field label="Password" name="password" type="password" placeholder="••••••••" />{err('password')}</div>
        {mode === 'register' && (
          <div><Field label="Confirm Password" name="confirmPassword" type="password" placeholder="••••••••" />{err('confirmPassword')}</div>
        )}
      </div>

      {mode === 'register' && (
        <div>
          <Field label="Referral Code" name="referralCode" placeholder="CLUTCH-XXXXX (optional)" required={false} />
          {err('referralCode')}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-input bg-accent px-4 py-3 text-sm font-bold text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] transition hover:bg-accent-strong disabled:opacity-60"
      >
        {loading && <Loader2 size={15} className="animate-spin" />}
        {mode === 'login' ? 'Sign In' : 'Create Account'}
      </button>

      {mode === 'login' && (
        <p className="text-center text-xs text-fg-3">
          Forgot your password? Use the reset link sent from{' '}
          <span className="font-semibold text-fg-2">Support → Email</span> — or contact WhatsApp support.
        </p>
      )}
    </form>
  );
}

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  return (
    <Suspense fallback={null}>
      <AuthFormInner mode={mode} />
    </Suspense>
  );
}
