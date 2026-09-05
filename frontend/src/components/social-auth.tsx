'use client';
// Social sign-in buttons (Google / Microsoft / Apple).
//
// The button list comes from the backend — a provider only renders when its
// credentials are configured server-side, so the UI never offers a login that
// cannot complete. Clicking a button navigates the WHOLE page into the OAuth
// redirect flow (provider consent → callback → back here with a session);
// client ids and secrets never touch the browser.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface Provider { id: 'google' | 'microsoft' | 'apple'; label: string }

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.09-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.25 1.05-3.72 1.05-2.86 0-5.29-1.93-6.15-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.85 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.35-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.67-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15A11 11 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.67 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 23 23" aria-hidden>
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.86-3.08.38-1.09-.5-2.08-.52-3.2 0-1.44.62-2.2.44-3.06-.38C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

const ICONS: Record<Provider['id'], () => React.ReactElement> = {
  google: GoogleIcon,
  microsoft: MicrosoftIcon,
  apple: AppleIcon,
};

export function SocialAuthButtons({ mode }: { mode: 'login' | 'register' }) {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const search = useSearchParams();
  const oauthError = search?.get('oauthError');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/backend/auth/oauth/providers', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json?.success) setProviders(json.data.providers ?? []);
        else if (!cancelled) setProviders([]);
      })
      .catch(() => { if (!cancelled) setProviders([]); });
    return () => { cancelled = true; };
  }, []);

  // Nothing configured → render nothing (password login stays the flow).
  if (!providers || providers.length === 0) {
    return oauthError ? (
      <p role="alert" className="rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-xs text-danger">
        {oauthError}
      </p>
    ) : null;
  }

  return (
    <div className="space-y-3">
      {oauthError && (
        <p role="alert" className="rounded-input border border-danger/30 bg-danger/10 px-4 py-2.5 text-xs text-danger">
          {oauthError}
        </p>
      )}
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-fg-3">or continue with</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {providers.map((p) => {
          const Icon = ICONS[p.id];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                // Full-page navigation into the OAuth redirect flow.
                window.location.href = `/api/backend/auth/oauth/${p.id}`;
              }}
              className="flex items-center justify-center gap-2 rounded-input border border-line bg-white/[3%] px-3 py-2.5 text-xs font-bold text-fg transition hover:border-accent/40 hover:bg-white/[6%] active:scale-[0.98]"
            >
              <Icon /> {p.label}
            </button>
          );
        })}
      </div>
      <p className="text-center text-[10px] leading-relaxed text-fg-3">
        After signing in with {mode === 'register' ? 'a social account' : 'Google, Microsoft or Apple'} you&apos;ll
        complete your Free Fire profile (UID, in-game name, phone) before you can join tournaments.
      </p>
    </div>
  );
}
