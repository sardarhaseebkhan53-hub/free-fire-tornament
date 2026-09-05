'use client';
// OAuth landing page — the backend redirects here after a social sign-in:
//   /auth/callback#access_token=…&profile=0|1&new=0|1
// Everything after the # stays in the browser (never hits a server log).
// This page stores the token, verifies the session, and routes:
//   • profile incomplete → /complete-profile (Free Fire UID, name, phone)
//   • profile complete   → dashboard (or ?next= when provided)
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { resetSessionBreaker } from '@/lib/client-api';
import { notifySessionChange } from '@/lib/session';

export default function OAuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = hash.get('access_token');
    const profileComplete = hash.get('profile') === '1';
    const next = new URLSearchParams(window.location.search).get('next');

    // Never leave the token sitting in the address bar / history.
    window.history.replaceState(null, '', '/auth/callback');

    if (!accessToken) {
      setError('The sign-in did not complete. Please try again.');
      return;
    }

    localStorage.setItem('cn_access', accessToken);
    resetSessionBreaker();
    notifySessionChange();

    // Confirm the session is live, then route on profile completeness.
    fetch('/api/backend/auth/me', {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const complete = typeof json?.data?.profileComplete === 'boolean'
          ? json.data.profileComplete
          : profileComplete;
        if (!complete) {
          router.replace(`/complete-profile${next ? `?next=${encodeURIComponent(next)}` : ''}`);
        } else {
          router.replace(next ?? '/dashboard');
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Even without the /me round trip the token is stored — fall back to
        // the flag the backend stamped on the redirect.
        if (!profileComplete) router.replace('/complete-profile');
        else router.replace(next ?? '/dashboard');
      });

    return () => { cancelled = true; };
  }, [router]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      {error ? (
        <>
          <p className="text-sm text-danger">{error}</p>
          <Link
            href="/login"
            className="mt-4 rounded-input bg-accent px-6 py-2.5 text-sm font-bold text-white"
          >
            Back to sign in
          </Link>
        </>
      ) : (
        <>
          <Loader2 className="animate-spin text-accent" size={28} />
          <p className="mt-4 text-sm font-semibold text-fg">Signing you in…</p>
          <p className="mt-1 text-xs text-fg-3">Checking your Free Fire player profile.</p>
        </>
      )}
    </div>
  );
}
