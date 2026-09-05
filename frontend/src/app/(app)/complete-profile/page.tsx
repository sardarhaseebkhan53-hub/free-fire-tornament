'use client';
// "Complete Your Free Fire Profile" — the mandatory gate between sign-in
// (password OR Google/Microsoft/Apple) and tournament registration.
//
// Three fields, all validated server-side: Free Fire UID, in-game name and
// phone number. Saving calls PUT /auth/profile with the bearer token, then
// routes the player to their original destination (?next=) or the dashboard.
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Gamepad2, Loader2, Phone, User } from 'lucide-react';
import { api, ApiClientError } from '@/lib/client-api';

interface MeShape {
  username: string;
  phone: string | null;
  profileComplete: boolean;
  missingProfileFields: string[];
  profile: { fullName: string | null; freeFireUID: string | null; freeFireIGN: string | null } | null;
}

const inputCls =
  'w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent focus:shadow-[0_0_0_3px_rgba(139,92,246,0.15)]';

function CompleteProfileInner() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search?.get('next') ?? '';

  const [me, setMe] = useState<MeShape | null>(null);
  const [uid, setUid] = useState('');
  const [ign, setIgn] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  // Prefill whatever the account already has.
  useEffect(() => {
    let cancelled = false;
    api<MeShape>('/auth/me')
      .then((data) => {
        if (cancelled) return;
        setMe(data);
        setUid(data.profile?.freeFireUID ?? '');
        setIgn(data.profile?.freeFireIGN ?? '');
        setPhone(data.phone ?? '');
      })
      .catch(() => {
        if (!cancelled) router.replace('/login?next=/complete-profile');
      });
    return () => { cancelled = true; };
  }, [router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const updated = await api<MeShape>('/auth/profile', {
        method: 'PUT',
        body: { freeFireUID: uid.trim(), freeFireIGN: ign.trim(), phone: phone.trim() },
      });
      if (!updated.profileComplete) {
        setError('Almost there — every field is required before you can join tournaments.');
        return;
      }
      setDone(true);
      window.setTimeout(() => router.replace(next || '/dashboard'), 700);
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors) setFieldErrors(err.fieldErrors);
      setError(err instanceof Error ? err.message : 'Could not save your profile. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md">
        <div className="glass rounded-card p-8 text-center">
          <CheckCircle2 className="mx-auto text-success" size={36} />
          <h1 className="mt-3 font-display text-xl font-bold text-fg">Profile complete!</h1>
          <p className="mt-1 text-sm text-fg-2">You can now register for tournaments.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Gamepad2 size={26} />
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold text-fg">Complete Your Free Fire Profile</h1>
        <p className="mt-2 text-sm text-fg-2">
          {me ? `Hey ${me.username} — ` : ''}one last step before you can enter the arena.
          Your Free Fire UID, in-game name and phone number are required for every tournament registration.
        </p>
      </div>

      <form onSubmit={onSubmit} className="glass mt-6 space-y-4 rounded-card p-6 sm:p-8">
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-3">
            <Gamepad2 size={12} /> Free Fire UID *
          </span>
          <input
            value={uid}
            onChange={(e) => setUid(e.target.value.replace(/[^\d]/g, '').slice(0, 15))}
            inputMode="numeric"
            placeholder="e.g. 5231879640"
            className={inputCls}
            required
          />
          <span className="mt-1 block text-[11px] text-fg-3">5–15 digits — find it on your Free Fire profile screen.</span>
          {fieldErrors.freeFireUID && <span className="mt-1 block text-[11px] font-medium text-danger">{fieldErrors.freeFireUID}</span>}
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-3">
            <User size={12} /> Free Fire In-Game Name *
          </span>
          <input
            value={ign}
            onChange={(e) => setIgn(e.target.value.slice(0, 24))}
            placeholder="Your in-game name"
            className={inputCls}
            required
          />
          {fieldErrors.freeFireIGN && <span className="mt-1 block text-[11px] font-medium text-danger">{fieldErrors.freeFireIGN}</span>}
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-3">
            <Phone size={12} /> Phone Number *
          </span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s-]/g, '').slice(0, 20))}
            inputMode="tel"
            type="tel"
            placeholder="+92 3xx xxxxxxx"
            className={inputCls}
            required
          />
          {fieldErrors.phone && <span className="mt-1 block text-[11px] font-medium text-danger">{fieldErrors.phone}</span>}
        </label>

        {error && (
          <p role="alert" className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-input bg-accent px-4 py-3 text-sm font-bold text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] transition hover:bg-accent-strong active:scale-[0.98] disabled:opacity-60"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          Save &amp; Continue
        </button>
        <p className="text-center text-[11px] text-fg-3">
          You can update these details anytime from your profile.
        </p>
      </form>
    </div>
  );
}

export default function CompleteProfilePage() {
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>}>
      <CompleteProfileInner />
    </Suspense>
  );
}
