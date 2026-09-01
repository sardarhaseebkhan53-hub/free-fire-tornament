import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiClientError, authedFetch } from './client-api';

type FetchInput = { body?: unknown; headers?: Headers };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api body serialisation (admin room PUT)', () => {
  it('serialises an object body once', async () => {
    let seen: FetchInput = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen = { body: init.body, headers: init.headers as Headers };
      return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    await api('/admin/tournaments/t123/room', { method: 'PUT', body: { roomId: '123456789' } });

    expect(String(seen.body)).toBe('{"roomId":"123456789"}');
    expect(seen.headers?.get('content-type')).toBe('application/json');
  });

  it('does not double-serialise a pre-serialised JSON string', async () => {
    let seen: FetchInput = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen = { body: init.body, headers: init.headers as Headers };
      return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    await api('/admin/tournaments/t123/room', { method: 'PUT', body: '{"roomId":"123456789"}' });

    // The body must stay a JSON object payload, NOT the quoted JSON-string literal
    // `"{\\"roomId\\":...}"`. This is what caused the backend 400.
    expect(String(seen.body)).toBe('{"roomId":"123456789"}');
    expect(seen.headers?.get('content-type')).toBe('application/json');
  });

  it('surfaces the backend field validation detail instead of a generic message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        errors: [{ path: 'roomId', message: 'Room ID must be numbers only — 3 to 20 digits.' }],
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )));

    const err = await api<string>('/admin/tournaments/t123/room', { method: 'PUT', body: { roomId: 'ab' } }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).code).toBe('VALIDATION_ERROR');
    expect((err as ApiClientError).message).toContain('roomId');
    expect((err as ApiClientError).message).toContain('Room ID must be numbers only');
    expect((err as ApiClientError).fieldErrors).toEqual({
      roomId: 'Room ID must be numbers only — 3 to 20 digits.',
    });
  });

  it('keeps the real HTTP status and server message on FORBIDDEN (join 403)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        success: false,
        code: 'FORBIDDEN',
        message: 'Account is not active.',
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )));

    const err = await api('/tournaments/join', { method: 'POST', body: { tournamentSlug: 'x' } }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(403);
    expect((err as ApiClientError).code).toBe('FORBIDDEN');
    expect((err as ApiClientError).message).toBe('Account is not active.');
  });
});

describe('authedFetch body safety (the [object Object] 400)', () => {
  it('serialises a plain object handed straight to authedFetch', async () => {
    let seen: FetchInput = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen = { body: init.body, headers: init.headers as Headers };
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    // A caller that forgets JSON.stringify used to send the literal text
    // "[object Object]", which the API could only answer with a 400.
    await authedFetch('/teams/t1/invite', { method: 'POST', body: { username: 'areeb' } as unknown as BodyInit });

    expect(String(seen.body)).toBe('{"username":"areeb"}');
    expect(seen.headers?.get('content-type')).toBe('application/json');
  });

  it('never touches a FormData body (uploads keep their multipart boundary)', async () => {
    let seen: FetchInput = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen = { body: init.body, headers: init.headers as Headers };
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const form = new FormData();
    form.append('file', 'x');
    await authedFetch('/wallet/deposits', { method: 'POST', body: form });

    expect(seen.body).toBe(form);
    expect(seen.headers?.get('content-type')).toBeNull();
  });
});
