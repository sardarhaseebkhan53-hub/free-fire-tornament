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
async function refreshAccessToken(): Promise<boolean> {
  if (!getToken()) return false;
  const refreshed = await fetch('/api/backend/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { [CLIENT_HEADER]: 'web' },
  });
  if (!refreshed.ok) return false;
  const rjson = (await refreshed.json()) as ApiEnvelope<{ accessToken: string }>;
  if (rjson.success && rjson.data?.accessToken) {
    localStorage.setItem('cn_access', rjson.data.accessToken);
    return true;
  }
  return false;
}

/** Authed fetch that transparently refreshes the access token once on a 401
 * and retries. Returns the raw Response so callers can consume blobs (CSV
 * export) or non-JSON payloads. */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set(CLIENT_HEADER, 'web');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const opts = { ...init, headers, credentials: 'include' as const };
  let res = await fetch(`/api/backend${path}`, opts);
  if (res.status === 401 && token && (await refreshAccessToken())) {
    if (getToken()) headers.set('authorization', `Bearer ${getToken()}`);
    res = await fetch(`/api/backend${path}`, opts);
  }
  return res;
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

async function rawFetch<T>(path: string, init: ApiInit): Promise<ApiEnvelope<T>> {
  let body: BodyInit | undefined;
  const headers: Record<string, string> = {};
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await authedFetch(path, { ...init, headers, body });
  const json = (await res.json().catch(() => ({ success: false, code: 'NETWORK', message: 'Bad response' }))) as ApiEnvelope<T>;
  return json;
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
  const json = await rawFetch<T>(path, init);

  if (!json.success) {
    const fieldErrors: Record<string, string> = {};
    for (const e of json.errors ?? []) fieldErrors[e.path] = e.message;
    throw new ApiClientError(
      json.code === 'UNAUTHORIZED' ? 401 : 400,
      json.code ?? 'ERROR',
      json.message ?? 'Request failed',
      Object.keys(fieldErrors).length ? fieldErrors : undefined,
    );
  }
  return json.data as T;
}
