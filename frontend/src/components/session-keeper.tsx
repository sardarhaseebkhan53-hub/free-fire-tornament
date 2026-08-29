'use client';
// =============================================================================
// SessionKeeper — keeps the user signed in while the 7-day refresh cookie is
// valid by silently refreshing the access token:
//   • on boot / tab revisit
//   • on a polling interval (covers long idle sessions)
//   • on window focus (covers backgrounded tabs where timers are throttled)
//
// The token is refreshed only when it is expired or within 2 minutes of
// expiry, so a live session never visibly flips to "signed out". Single-flight
// refresh in client-api makes the polls nearly free. If refresh fails (session
// genuinely dead), the UI falls back to signed-out via the normal 401 flow.
// =============================================================================
import { useEffect } from 'react';
import { getToken, silentlyRefreshSession } from '@/lib/client-api';

const REFRESH_IF_LEFT_MS = 2 * 60_000; // refresh when < 2 min until expiry
const POLL_MS = 45_000;

function msUntilExpiry(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number };
    if (typeof payload.exp !== 'number') return 0;
    return payload.exp * 1000 - Date.now();
  } catch {
    return 0;
  }
}

function maybeRefresh(): void {
  const token = getToken();
  if (!token) return;
  if (msUntilExpiry(token) < REFRESH_IF_LEFT_MS) void silentlyRefreshSession();
}

export function SessionKeeper() {
  useEffect(() => {
    maybeRefresh(); // boot
    const id = setInterval(maybeRefresh, POLL_MS);
    const onFocus = () => maybeRefresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return null;
}
