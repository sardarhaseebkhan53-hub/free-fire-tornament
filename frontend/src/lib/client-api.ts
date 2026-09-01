// Shared authed browser API helper — bearer token from localStorage with a
// single transparent refresh-retry on 401 (rotating HttpOnly cookie proxy).
export interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  code?: string;
  data?: T;
  errors?: Array<{ path: string; message: string }>;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('cn_access');
}

/** Authed fetch against the /api/backend proxy. Retries once after a refresh
 * when the access token expired. Returns the envelope; throws ApiClientError
 * on hard failures so pages can show honest error states. */
export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Marks the request as first-party. The API refuses cookie-authenticated
 * calls (session refresh / logout) without it — a cross-site form cannot set
 * custom headers, so this is the CSRF layer on top of SameSite + CORS. */
const CLIENT_HEADER = 'x-clutchnex-client';

type ApiInit = Omit<RequestInit, 'body'> & { body?: unknown; form?: FormData };

/** Rotate the access token via the HttpOnly refresh cookie. Returns true on success. */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Circuit breaker. Once the backend says the refresh cookie is gone (401/403),
 * the session is unrecoverable without a fresh sign-in: every further attempt
 * is guaranteed to fail. Without this flag the SessionKeeper poll + every page
 * request kept re-firing /auth/refresh forever, flooding the console with
 * "401 (Unauthorized)" and hammering the API. A successful sign-in stores a new
 * token, which re-arms the breaker automatically.
 */
let sessionDead = false;
/** Soft backoff for transient (network) refresh failures. */
let nextRefreshAllowedAt = 0;
const REFRESH_BACKOFF_MS = 10_000;

/** Wipe the local session and tell every session hook in the tab. */
function killLocalSession(): void {
  sessionDead = true;
  try {
    localStorage.removeItem('cn_access');
  } catch {
    /* storage disabled — nothing to clear */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('storage'));
}

/** Called when a token is present again (fresh sign-in) — re-arm refreshing. */
export function resetSessionBreaker(): void {
  sessionDead = false;
  nextRefreshAllowedAt = 0;
}

/**
 * Single-flight refresh: when several requests hit a 401 at the same moment
 * (access-token expiry usually coincides with a page firing parallel calls),
 * they ALL await ONE refresh instead of racing with the same single-use
 * refresh cookie. Without this, parallel refreshes trip the backend's
 * rotation-replay detection and nuke the session.
 */
function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefreshAccessToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefreshAccessToken(): Promise<boolean> {
  if (!getToken()) return false;
  // Session already proven dead, or we failed very recently — don't spam.
  if (sessionDead || Date.now() < nextRefreshAllowedAt) return false;
  if (process.env.NODE_ENV === 'development') {
    console.info('[auth] access token expired — refreshing via cookie…');
  }
  try {
    const refreshed = await fetch('/api/backend/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { [CLIENT_HEADER]: 'web' },
    });
    if (!refreshed.ok) {
      // Dev-only diagnostics — never log tokens, cookies or credentials.
      // Logged ONCE: the breaker below stops any further attempt.
      if (refreshed.status === 401 || refreshed.status === 403) {
        if (process.env.NODE_ENV === 'development') {
          console.info(`[auth] refresh rejected (${refreshed.status}) — session ended; sign-in required.`);
        }
        killLocalSession();
      } else {
        nextRefreshAllowedAt = Date.now() + REFRESH_BACKOFF_MS;
      }
      return false;
    }
    const rjson = (await refreshed.json()) as ApiEnvelope<{ accessToken: string }>;
    if (rjson.success && rjson.data?.accessToken) {
      localStorage.setItem('cn_access', rjson.data.accessToken);
      // Wake every useSyncExternalStore session hook (navbar, bottom nav,
      // user shell) so the UI reflects the fresh token immediately.
      window.dispatchEvent(new Event('storage'));
      if (process.env.NODE_ENV === 'development') {
        console.info('[auth] access token refreshed.');
      }
      return true;
    }
    // 200 but no token in the envelope — treat as an ended session.
    killLocalSession();
    return false;
  } catch (e) {
    // Network blip: back off briefly, but keep the session alive.
    nextRefreshAllowedAt = Date.now() + REFRESH_BACKOFF_MS;
    if (process.env.NODE_ENV === 'development') {
      console.info('[auth] refresh request failed (network):', e instanceof Error ? e.message : e);
    }
    return false;
  }
}

/** Milliseconds until the stored access token expires (0 if unreadable/absent). */
function msUntilAccessExpiry(): number {
  const token = getToken();
  if (!token) return 0;
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number };
    if (typeof payload.exp !== 'number') return 0;
    return payload.exp * 1000 - Date.now();
  } catch {
    return 0;
  }
}

/**
 * Last line of defence against the 400 that has bitten this app twice:
 * `fetch()` stringifies an unknown body with String(value), so a plain object
 * handed to authedFetch goes on the wire as the literal text `[object Object]`
 * and the API answers "Malformed JSON body" — pointing at the server, not at
 * the call site. Anything fetch can send natively (string, FormData, Blob,
 * ArrayBuffer, URLSearchParams, ReadableStream) is passed through untouched;
 * a plain object is serialised once, exactly like `api()` does.
 */
function serialisableBody(body: BodyInit | null | undefined, headers: Headers): BodyInit | null | undefined {
  if (body === null || body === undefined) return body;
  if (typeof body === 'string') return body;
  if (
    typeof FormData !== 'undefined' && body instanceof FormData ||
    typeof Blob !== 'undefined' && body instanceof Blob ||
    typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams ||
    typeof ReadableStream !== 'undefined' && body instanceof ReadableStream ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body as ArrayBufferView)
  ) {
    return body;
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return JSON.stringify(body);
}

/** Authed fetch against a fully-resolved URL (e.g. an uploaded-image path that
 * has already been normalized to /api/backend/...). Shares the single
 * refresh-once-on-401 implementation with authedFetch so no call site keeps its
 * own token-rotation copy (§E.4 cleanup). */
export async function authedFetchResolved(url: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set(CLIENT_HEADER, 'web');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const opts = { ...init, headers, body: serialisableBody(init.body, headers), credentials: 'include' as const };

  // Proactive refresh: if the token is about to expire (or already has),
  // refresh FIRST so a page never fires a burst of doomed requests that all
  // 401. Single-flight makes this nearly free. If refresh fails, proceed with
  // the request anyway — the server's 401 then flows through normal handling.
  if (token && msUntilAccessExpiry() < 30_000 && (await refreshAccessToken())) {
    if (getToken()) headers.set('authorization', `Bearer ${getToken()}`);
  }

  let res = await fetch(url, opts);
  if (res.status === 401 && token && (await refreshAccessToken())) {
    if (getToken()) headers.set('authorization', `Bearer ${getToken()}`);
    res = await fetch(url, opts);
  }
  return res;
}

/** Authed fetch that transparently refreshes the access token once on a 401
 * and retries. Returns the raw Response so callers can consume blobs (CSV
 * export) or non-JSON payloads. The `path` is an API path (the /api/backend
 * proxy prefix is added here). */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return authedFetchResolved(`/api/backend${path}`, init);
}

/** Download a protected response without navigating the browser to a URL that
 * cannot carry the localStorage bearer token. */
export async function downloadProtectedFile(path: string, filename: string): Promise<void> {
  const res = await authedFetch(path);
  if (!res.ok) {
    throw new ApiClientError(res.status, res.status === 401 ? 'UNAUTHORIZED' : 'DOWNLOAD_FAILED', 'Download failed.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function rawFetch<T>(path: string, init: ApiInit): Promise<{ json: ApiEnvelope<T>; status: number }> {
  let body: BodyInit | undefined;
  const headers: Record<string, string> = {};
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    // Accept both call styles: callers can pass an object (this helper serialises it)
    // OR a pre-serialised JSON string. Double serialising a string turns
    //   {"roomId":"123"}
    // into the JSON string
    //   "{\"roomId\":\"123\"}"
    // which Express parses as a *string*, not an object — the backend then rejects the
    // request with a 400 ("expected object, received string").
    body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
  }
  const res = await authedFetch(path, { ...init, headers, body });
  const json = (await res.json().catch(() => ({ success: false, code: 'NETWORK', message: 'Bad response' }))) as ApiEnvelope<T>;
  return { json, status: res.status };
}

/** Fire-and-forget silent refresh for app boot / navigation. Returns the new
 * access token, or null when the session is genuinely gone. Never throws. */
export async function silentlyRefreshSession(): Promise<string | null> {
  const ok = await refreshAccessToken();
  return ok ? getToken() : null;
}

/** Authed GET with the same refresh-once semantics; returns data or null on failure. */
export async function apiGet<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch {
    return null;
  }
}

export async function api<T>(
  path: string,
  init: ApiInit = {},
): Promise<T> {
  // rawFetch already performs the refresh-once retry on a 401 (see authedFetch).
  const { json, status } = await rawFetch<T>(path, init);

  if (!json.success) {
    const fieldErrors: Record<string, string> = {};
    const fieldMessages: string[] = [];
    // `errors` is an array only for Zod validation failures (and other details-shaped
    // ApiError payloads). Some ApiError responses carry an object under `errors`
    // (e.g. economic-safety details), so only iterate when it is really a list.
    if (Array.isArray(json.errors)) {
      for (const e of json.errors) {
        fieldErrors[e.path] = e.message;
        // Zod responses from the backend use a generic `message: "Validation failed"`
        // and put the real problem in `errors[]`. Surface that field detail instead of
        // the generic string so an admin can see which value the API actually rejected.
        fieldMessages.push(e.path ? `${e.path}: ${e.message}` : e.message);
      }
    }
    throw new ApiClientError(
      status || (json.code === 'UNAUTHORIZED' ? 401 : 400),
      json.code ?? 'ERROR',
      fieldMessages.length ? fieldMessages.join('; ') : (json.message ?? 'Request failed'),
      Object.keys(fieldErrors).length ? fieldErrors : undefined,
    );
  }
  return json.data as T;
}
