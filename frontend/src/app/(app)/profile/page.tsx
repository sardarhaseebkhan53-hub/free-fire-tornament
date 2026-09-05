'use client';
// Player profile — view + update the account's Free Fire identity.
// The same three fields (UID, in-game name, phone) gate tournament
// registration for every sign-in method (password, Google, Microsoft, Apple).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { BadgeCheck, CheckCircle2, Gamepad2, Loader2, Phone, Save, User } from 'lucide-react';
import { api, apiGet, ApiClientError } from '@/lib/client-api';

interface MeShape {
  username: string;
  email: string;
  phone: string | null;
  authProvider: string;
  profileComplete: boolean;
  missingProfileFields: string[];
  profile: {
    fullName: string | null;
    freeFireUID: string | null;
    freeFireIGN: string | null;
    city: string | null;
    bio: string | null;
  } | null;
}

const inputCls =
  'w-full rounded-input border border-line bg-white/[3%] px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-fg-3 focus:border-accent focus:shadow-[0_0_0_3px_rgba(139,92,246,0.15)] disabled:opacity-50';

const PROVIDER_LABEL: Record<string, string> = {
  PASSWORD: 'Email & password',
  GOOGLE: 'Google',
  MICROSOFT: 'Microsoft',
  APPLE: 'Apple ID',
};

export default function ProfilePage() {
  const [me, setMe] = useState<MeShape | null>(null);
  const [fullName, setFullName] = useState('');
  const [uid, setUid] = useState('');
  const [ign, setIgn] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const data = await apiGet<MeShape>('/auth/me');
    if (!data) return;
    setMe(data);
    setFullName(data.profile?.fullName ?? '');
    setUid(data.profile?.freeFireUID ?? '');
    setIgn(data.profile?.freeFireIGN ?? '');
    setPhone(data.phone ?? '');
    setCity(data.profile?.city ?? '');
    setBio(data.profile?.bio ?? '');
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSavedMsg(null);
    setFieldErrors({});
    try {
      await api('/auth/profile', {
        method: 'PUT',
        body: {
          fullName: fullName.trim() || undefined,
          freeFireUID: uid.trim() || null,
          freeFireIGN: ign.trim() || null,
          phone: phone.trim() || null,
          city: city.trim() || null,
          bio: bio.trim() || null,
        },
      });
      setSavedMsg('Profile updated.');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors) setFieldErrors(err.fieldErrors);
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  const provider = PROVIDER_LABEL[me.authProvider] ?? me.authProvider;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-fg">My Profile</h1>
        <p className="mt-1 text-sm text-fg-2">
          Signed in with <strong className="text-fg">{provider}</strong> · @{me.username}
        </p>
      </div>

      {/* Free Fire profile status */}
      <div className={`rounded-card border p-4 ${me.profileComplete ? 'border-success/30 bg-success/[7%]' : 'border-warning/30 bg-warning/[8%]'}`}>
        {me.profileComplete ? (
          <p className="flex items-center gap-2 text-sm font-bold text-success">
            <BadgeCheck size={16} /> Free Fire profile complete — you can register for any tournament.
          </p>
        ) : (
          <div className="text-sm">
            <p className="flex items-center gap-2 font-bold text-warning">
              <CheckCircle2 size={16} /> Complete your Free Fire profile to unlock tournaments.
            </p>
            <p className="mt-1 text-xs text-fg-2">
              Missing: {me.missingProfileFields.map((f) => (f === 'freeFireUID' ? 'Free Fire UID' : f === 'freeFireIGN' ? 'in-game name' : 'phone number')).join(', ')}.
            </p>
            <Link href="/complete-profile" className="mt-2 inline-block rounded-input bg-accent px-4 py-2 text-xs font-bold text-white">
              Complete profile now
            </Link>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="glass space-y-5 rounded-card p-5 sm:p-6">
        <div>
          <h2 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.12em] text-fg">
            <Gamepad2 size={14} className="text-accent" /> Free Fire identity
          </h2>
          <p className="mt-1 text-xs text-fg-3">Required for tournament registration. The UID must match your in-game account.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-fg-2">Free Fire UID *</span>
              <input
                value={uid}
                onChange={(e) => setUid(e.target.value.replace(/[^\d]/g, '').slice(0, 15))}
                inputMode="numeric"
                placeholder="5231879640"
                className={inputCls}
              />
              {fieldErrors.freeFireUID && <span className="mt-1 block text-[11px] font-medium text-danger">{fieldErrors.freeFireUID}</span>}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-fg-2">In-game name *</span>
              <input
                value={ign}
                onChange={(e) => setIgn(e.target.value.slice(0, 24))}
                placeholder="Your IGN"
                className={inputCls}
              />
              {fieldErrors.freeFireIGN && <span className="mt-1 block text-[11px] font-medium text-danger">{fieldErrors.freeFireIGN}</span>}
            </label>
          </div>
        </div>

        <div>
          <h2 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.12em] text-fg">
            <User size={14} className="text-accent" /> Account details
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-fg-2">Full name</span>
              <input value={fullName} onChange={(e) => setFullName(e.target.value.slice(0, 60))} className={inputCls} placeholder="Your name" />
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-fg-2"><Phone size={11} /> Phone number *</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s-]/g, '').slice(0, 20))}
                inputMode="tel"
                type="tel"
                placeholder="+92 3xx xxxxxxx"
                className={inputCls}
              />
              {fieldErrors.phone && <span className="mt-1 block text-[11px] font-medium text-danger">{fieldErrors.phone}</span>}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-fg-2">City</span>
              <input value={city} onChange={(e) => setCity(e.target.value.slice(0, 60))} className={inputCls} placeholder="Karachi" />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold text-fg-2">Bio</span>
              <textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, 240))} rows={2} className={inputCls} placeholder="Tell other players about yourself" />
            </label>
          </div>
        </div>

        {error && <p role="alert" className="rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">{error}</p>}
        {savedMsg && !error && <p className="rounded-input border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success">{savedMsg}</p>}

        <div className="flex justify-end border-t border-line pt-4">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-input bg-accent px-6 py-2.5 text-sm font-bold text-white shadow-[0_0_18px_rgba(139,92,246,0.35)] disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save profile
          </button>
        </div>
      </form>
    </div>
  );
}
