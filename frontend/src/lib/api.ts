// Server-side API client (React Server Components only).
// Browser code must use the relative /api/backend/* proxy instead.
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:4000';

export class ApiFetchError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiServer<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}/api${path}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new ApiFetchError(res.status, `API ${path} → ${res.status}`);
  }
  const json = (await res.json()) as { success: boolean; data: T };
  return json.data;
}

/** Like apiServer but returns null instead of throwing (for resilient pages). */
export async function apiServerSafe<T>(path: string): Promise<T | null> {
  try {
    return await apiServer<T>(path);
  } catch {
    return null;
  }
}

/**
 * For detail pages (tournament, player profile, blog article, legal page).
 *
 * Returns the resource when it exists, `null` when the backend answers a real
 * 404 (so the page can render notFound()), and RE-THROWS on any other status
 * (5xx/503/network) so it hits Next's error boundary instead of being shown as
 * a misleading 404. Previously these pages used apiServerSafe (which collapses
 * EVERY failure to null → notFound), so a transient/schema 500 rendered as the
 * "This zone is off the map" 404 — the wrong problem, pointing nowhere.
 */
export async function apiServerDetail<T>(path: string): Promise<T | null> {
  try {
    return await apiServer<T>(path);
  } catch (e) {
    if (e instanceof ApiFetchError && e.status === 404) return null;
    throw e;
  }
}
