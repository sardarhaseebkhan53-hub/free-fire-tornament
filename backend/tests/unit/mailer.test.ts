// =============================================================================
// Unit — mail transport. No network: fetch and sleep are injected, and the SMTP
// path is exercised through a stubbed nodemailer transport.
// =============================================================================
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMailer, deliver, MailDeliveryError, type Mailer } from '../../src/lib/mailer';
import { passwordResetEmail, sendMail, setMailerForTests, verificationEmail } from '../../src/services/email.service';

const CONFIG = {
  provider: 'resend' as const,
  from: 'CLUTCHNEX <no-reply@clutchnex.gg>',
  timeoutMs: 1000,
  attempts: 3,
};

const MESSAGE = { to: 'player@example.com', subject: 'Test', html: '<p>hi</p>' };

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => setMailerForTests(null));

describe('buildMailer — provider wiring', () => {
  it('sends through the Resend API with the right shape', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(200, { id: 'res_123' }));
    const mailer = buildMailer({ ...CONFIG, resendApiKey: 're_test' }, { fetch: fetchMock as never });

    const out = await mailer.send(MESSAGE);

    expect(out.messageId).toBe('res_123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.from).toBe('CLUTCHNEX <no-reply@clutchnex.gg>');
    expect(body.to).toEqual(['player@example.com']);
    expect(body.subject).toBe('Test');
  });

  it('sends through Postmark with its server token header', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(200, { MessageID: 'pm_1' }));
    const mailer = buildMailer(
      { ...CONFIG, provider: 'postmark', postmarkServerToken: 'pm_token' },
      { fetch: fetchMock as never },
    );

    const out = await mailer.send(MESSAGE);

    expect(out.messageId).toBe('pm_1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect((init.headers as Record<string, string>)['x-postmark-server-token']).toBe('pm_token');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.To).toBe('player@example.com');
    expect(body.HtmlBody).toBe('<p>hi</p>');
  });

  it('refuses a provider whose credentials are missing', () => {
    expect(() => buildMailer({ ...CONFIG })).toThrow(/RESEND_API_KEY/);
    expect(() => buildMailer({ ...CONFIG, provider: 'postmark' })).toThrow(/POSTMARK_SERVER_TOKEN/);
    expect(() => buildMailer({ ...CONFIG, provider: 'smtp' })).toThrow(/SMTP_HOST/);
  });

  it('refuses an unknown provider', () => {
    expect(() => buildMailer({ ...CONFIG, provider: 'pigeon' as never })).toThrow(/Unsupported EMAIL_PROVIDER/);
  });

  it('the log provider writes the message instead of sending it', async () => {
    const lines: string[] = [];
    const mailer = buildMailer({ ...CONFIG, provider: 'log' }, { log: (l) => lines.push(l) });
    const out = await mailer.send(MESSAGE);
    expect(out.messageId).toMatch(/^log-/);
    expect(lines.join('\n')).toContain('player@example.com');
    expect(lines.join('\n')).toContain('<p>hi</p>');
  });
});

describe('deliver — retries and failure reporting', () => {
  const flaky = (responses: Array<Error | { messageId?: string }>): Mailer => {
    let i = 0;
    return {
      name: 'flaky',
      async send() {
        const next = responses[i++]!;
        if (next instanceof Error) throw next;
        return next;
      },
    };
  };

  it('succeeds on the first attempt without retrying', async () => {
    const out = await deliver(flaky([{ messageId: 'm1' }]), MESSAGE, { attempts: 3 }, { sleep: async () => {} });
    expect(out).toMatchObject({ delivered: true, attempts: 1, messageId: 'm1' });
  });

  it('retries a transient failure and reports how many attempts it took', async () => {
    const slept: number[] = [];
    const mailer = flaky([
      new MailDeliveryError('503 upstream', true),
      new MailDeliveryError('timeout', true),
      { messageId: 'm2' },
    ]);
    const out = await deliver(mailer, MESSAGE, { attempts: 3 }, { sleep: async (ms) => { slept.push(ms); } });

    expect(out).toMatchObject({ delivered: true, attempts: 3, messageId: 'm2' });
    expect(slept).toHaveLength(2); // backed off between attempts
    expect(slept[1]!).toBeGreaterThan(slept[0]!); // exponentially
  });

  it('does NOT retry a permanent failure (bad credentials)', async () => {
    let calls = 0;
    const mailer: Mailer = {
      name: 'permanent',
      async send() {
        calls++;
        throw new MailDeliveryError('401 unauthorized', false);
      },
    };
    const out = await deliver(mailer, MESSAGE, { attempts: 3 }, { sleep: async () => {} });

    expect(out.delivered).toBe(false);
    expect(calls).toBe(1);
    expect(out.error).toContain('401');
  });

  it('gives up after the configured attempts and returns the error', async () => {
    const out = await deliver(
      flaky([new MailDeliveryError('boom 1', true), new MailDeliveryError('boom 2', true)]),
      MESSAGE,
      { attempts: 2 },
      { sleep: async () => {} },
    );
    expect(out).toMatchObject({ delivered: false, attempts: 2 });
    expect(out.error).toContain('boom 2');
  });

  it('an HTTP 5xx is retryable, a 4xx is not', async () => {
    const five = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(503, { error: 'down' }));
    const four = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(422, { error: 'bad address' }));

    const r5 = await deliver(
      buildMailer({ ...CONFIG, resendApiKey: 'k' }, { fetch: five as never }),
      MESSAGE,
      { attempts: 3 },
      { sleep: async () => {} },
    );
    expect(r5.delivered).toBe(false);
    expect(five).toHaveBeenCalledTimes(3); // retried

    const r4 = await deliver(
      buildMailer({ ...CONFIG, resendApiKey: 'k' }, { fetch: four as never }),
      MESSAGE,
      { attempts: 3 },
      { sleep: async () => {} },
    );
    expect(r4.delivered).toBe(false);
    expect(four).toHaveBeenCalledTimes(1); // not retried
  });
});

describe('sendMail — the auth-flow contract', () => {
  it('never throws when the provider blows up', async () => {
    setMailerForTests({
      name: 'broken',
      async send() {
        throw new MailDeliveryError('connection refused', true);
      },
    });
    await expect(sendMail(verificationEmail('a@example.com', 'tok'))).resolves.toMatchObject({
      delivered: false,
    });
  });

  it('reports success when the provider delivers', async () => {
    setMailerForTests({ name: 'ok', send: async () => ({ messageId: 'x1' }) });
    await expect(sendMail(passwordResetEmail('a@example.com', 'tok'))).resolves.toMatchObject({
      delivered: true,
      messageId: 'x1',
    });
  });
});

describe('templates', () => {
  it('verification email carries a token link and a plain-text fallback', () => {
    const m = verificationEmail('player@example.com', 'abc/def+ghi');
    expect(m.to).toBe('player@example.com');
    expect(m.subject).toMatch(/verify/i);
    expect(m.html).toContain('/verify-email?token=abc%2Fdef%2Bghi');
    expect(m.text).toContain('/verify-email?token=');
  });

  it('password reset email carries a token link and a plain-text fallback', () => {
    const m = passwordResetEmail('player@example.com', 'tok123');
    expect(m.html).toContain('/reset-password?token=tok123');
    expect(m.text).toContain('/reset-password?token=tok123');
  });

  it('escapes the token so it cannot break out of the URL', () => {
    const m = verificationEmail('p@example.com', '"><script>alert(1)</script>');
    expect(m.html).not.toContain('<script>alert(1)</script>');
    expect(m.html).toContain('%3Cscript%3E');
  });
});
