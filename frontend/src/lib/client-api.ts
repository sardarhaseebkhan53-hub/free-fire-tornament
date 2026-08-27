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

async function rawFetch<T>(path: string, init: ApiInit): Promise<ApiEnvelope<T>> {
  const token = getToken();
  const headers: Record<string, string> = { [CLIENT_HEADER]: 'web' };
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`/api/backend${path}`, { ...init, headers, body, credentials: 'include' });
  const json = (await res.json().catch(() => ({ success: false, code: 'NETWORK', message: 'Bad response' }))) as ApiEnvelope<T>;
  return json;
}

export async function api<T>(
  path: string,
  init: ApiInit = {},
): Promise<T> {
  let json = await rawFetch<T>(path, init);

  // Access token expired → rotate via refresh cookie and retry once.
  if (!json.success && json.code === 'UNAUTHORIZED' && getToken()) {
    const refreshed = await fetch('/api/backend/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { [CLIENT_HEADER]: 'web' },
    });
    if (refreshed.ok) {
      const rjson = (await refreshed.json()) as ApiEnvelope<{ accessToken: string }>;
      if (rjson.success && rjson.data?.accessToken) {
        localStorage.setItem('cn_access', rjson.data.accessToken);
        json = await rawFetch<T>(path, init);
      }
    }
  }

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
