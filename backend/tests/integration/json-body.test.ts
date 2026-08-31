// =============================================================================
// Integration — how the API reads a request body.
//
// REGRESSION: the admin room panel answered "Malformed JSON body." on Save and
// on Hide. The payload was valid JSON; it had simply been serialised twice, and
// body-parser's strict mode rejects a top-level JSON *string* with the same
// error class as genuinely corrupt bytes. An admin therefore could not save a
// Room ID, and the message pointed at the server instead of the caller.
//
// The rules this suite pins down:
//   • a normal object body still works (nothing here loosens validation);
//   • a double-serialised body is unwrapped once and validated normally;
//   • text that is not JSON at all is refused — with a message that says what
//     actually arrived, not a generic 400;
//   • an empty JSON body is an empty object, not a crash.
//
// The route used is a public one (`/api/auth/login`) so the assertions are
// about BODY HANDLING only: reaching zod/the service at all proves the body
// survived the middleware, and the exact auth outcome is irrelevant.
// =============================================================================
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../src/app';

let server: Server;
let base = '';

beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

const post = (body: string) =>
  fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-clutchnex-client': 'web' },
    body,
  });

describe('JSON body handling', () => {
  it('accepts an ordinary object body', async () => {
    const res = await post(JSON.stringify({ identifier: 'nobody@example.com', password: 'Whatever@123' }));
    const json = (await res.json()) as { code?: string };
    // Wrong credentials or a validation failure are both fine — MALFORMED_JSON is not.
    expect(json.code).not.toBe('MALFORMED_JSON');
  });

  it('unwraps a double-serialised body instead of rejecting it', async () => {
    // What a client that called JSON.stringify() twice puts on the wire.
    const res = await post(JSON.stringify(JSON.stringify({ identifier: 'nobody@example.com', password: 'Whatever@123' })));
    const json = (await res.json()) as { code?: string };
    expect(json.code).not.toBe('MALFORMED_JSON');
  });

  it('reads an empty JSON body as an empty object (validation, not a 500)', async () => {
    const res = await post('""');
    const json = (await res.json()) as { code?: string };
    expect(res.status).toBe(400);
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a plain-text body with a message that names the mistake', async () => {
    const res = await post('"just some text"');
    const json = (await res.json()) as { code?: string; message?: string };
    expect(res.status).toBe(400);
    expect(json.code).toBe('MALFORMED_JSON');
    expect(json.message).toMatch(/JSON object/i);
  });

  it('explains the classic `[object Object]` body', async () => {
    // fetch(url, { body: someObject }) — no JSON.stringify.
    const res = await post('[object Object]');
    const json = (await res.json()) as { code?: string; message?: string };
    expect(res.status).toBe(400);
    expect(json.code).toBe('MALFORMED_JSON');
    expect(json.message).toMatch(/JSON\.stringify/);
  });

  it('still rejects genuinely broken JSON', async () => {
    const res = await post('{"identifier": ');
    const json = (await res.json()) as { code?: string };
    expect(res.status).toBe(400);
    expect(json.code).toBe('MALFORMED_JSON');
  });
});
