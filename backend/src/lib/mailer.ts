// =============================================================================
// Mail transport — provider-agnostic delivery with retries and timeouts.
//
// Supported providers:
//   log       — print to stdout (development; refused in production)
//   smtp      — any SMTP relay via nodemailer (SES SMTP, Postfix, Google, …)
//   resend    — https://resend.com HTTP API
//   postmark  — https://postmarkapp.com HTTP API
//
// Design rules:
//   • Auth flows must never hang or fail because mail is slow — every attempt
//     is bounded by a timeout and the whole send is retried a fixed number of
//     times, then reported rather than thrown.
//   • Retries only happen for transient faults (network errors and 5xx). A 4xx
//     means the credentials or the address are wrong; retrying just hides it.
//   • Secrets stay in env; nothing here reads process.env directly.
// =============================================================================
import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface MailerConfig {
  provider: 'log' | 'smtp' | 'resend' | 'postmark';
  from: string;
  replyTo?: string;
  /** Per-attempt budget in ms. */
  timeoutMs: number;
  /** Total attempts (1 = no retry). */
  attempts: number;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
  };
  resendApiKey?: string;
  postmarkServerToken?: string;
}

export interface MailerResult {
  delivered: boolean;
  provider: string;
  attempts: number;
  messageId?: string;
  error?: string;
}

export interface Mailer {
  readonly name: string;
  send(message: MailMessage): Promise<{ messageId?: string }>;
}

/** Injectable so tests never touch the network or a real SMTP socket. */
export interface MailerDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MailDeliveryError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

// --- providers ---------------------------------------------------------------

function logMailer(config: MailerConfig, deps: MailerDeps): Mailer {
  const log = deps.log ?? ((line: string) => console.log(line));
  return {
    name: 'log',
    async send(message) {
      log(`[email:log] to=${message.to} subject="${message.subject}"\n${message.html}\n`);
      return { messageId: `log-${Date.now()}` };
    },
  };
  void config;
}

function smtpMailer(config: MailerConfig): Mailer {
  const smtp = config.smtp;
  if (!smtp?.host) throw new Error('EMAIL_PROVIDER=smtp requires SMTP_HOST.');
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.pass } } : {}),
    // Fail fast rather than holding an auth flow open on a dead relay.
    connectionTimeout: config.timeoutMs,
    greetingTimeout: config.timeoutMs,
    socketTimeout: config.timeoutMs,
  });
  return {
    name: 'smtp',
    async send(message) {
      try {
        const info = await transport.sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(config.replyTo ? { replyTo: config.replyTo } : {}),
        });
        return { messageId: info.messageId };
      } catch (e) {
        const err = e as { code?: string; responseCode?: number; message?: string };
        // 5xx and connection faults are worth another try; 4xx are not.
        const status = err.responseCode ?? 0;
        const retryable = status === 0 || status >= 500;
        throw new MailDeliveryError(err.message ?? 'SMTP send failed', retryable);
      }
    },
  };
}

function resendMailer(config: MailerConfig, deps: MailerDeps): Mailer {
  if (!config.resendApiKey) throw new Error('EMAIL_PROVIDER=resend requires RESEND_API_KEY.');
  const doFetch = deps.fetch ?? fetch;
  return {
    name: 'resend',
    async send(message) {
      const res = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.resendApiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: config.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          ...(message.text ? { text: message.text } : {}),
          ...(config.replyTo ? { reply_to: config.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new MailDeliveryError(`Resend ${res.status}: ${body.slice(0, 200)}`, res.status >= 500);
      }
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      return { messageId: json.id };
    },
  };
}

function postmarkMailer(config: MailerConfig, deps: MailerDeps): Mailer {
  if (!config.postmarkServerToken) {
    throw new Error('EMAIL_PROVIDER=postmark requires POSTMARK_SERVER_TOKEN.');
  }
  const doFetch = deps.fetch ?? fetch;
  return {
    name: 'postmark',
    async send(message) {
      const res = await doFetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'x-postmark-server-token': config.postmarkServerToken,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          From: config.from,
          To: message.to,
          Subject: message.subject,
          HtmlBody: message.html,
          ...(message.text ? { TextBody: message.text } : {}),
          ...(config.replyTo ? { ReplyTo: config.replyTo } : {}),
          MessageStream: 'outbound',
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new MailDeliveryError(`Postmark ${res.status}: ${body.slice(0, 200)}`, res.status >= 500);
      }
      const json = (await res.json().catch(() => ({}))) as { MessageID?: string };
      return { messageId: json.MessageID };
    },
  };
}

export function buildMailer(config: MailerConfig, deps: MailerDeps = {}): Mailer {
  switch (config.provider) {
    case 'log':
      return logMailer(config, deps);
    case 'smtp':
      return smtpMailer(config);
    case 'resend':
      return resendMailer(config, deps);
    case 'postmark':
      return postmarkMailer(config, deps);
    default:
      throw new Error(`Unsupported EMAIL_PROVIDER: ${String(config.provider)}`);
  }
}

// --- send with retry ---------------------------------------------------------

/**
 * Deliver with bounded retries. Never throws: mail is a side effect of the auth
 * flows, and a token stays valid server-side whether or not the message lands —
 * the player can always request a resend. The outcome is returned so callers
 * (and ops) can see what happened.
 */
export async function deliver(
  mailer: Mailer,
  message: MailMessage,
  config: Pick<MailerConfig, 'attempts'>,
  deps: MailerDeps = {},
): Promise<MailerResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const attempts = Math.max(1, config.attempts);
  let lastError = '';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const out = await mailer.send(message);
      return { delivered: true, provider: mailer.name, attempts: attempt, messageId: out.messageId };
    } catch (e) {
      const err = e as { message?: string; retryable?: boolean };
      lastError = err.message ?? 'unknown mail error';
      const retryable = err.retryable !== false;
      if (!retryable || attempt === attempts) break;
      // Exponential backoff: 500ms, 1s, 2s, 4s…
      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  console.error(`[email] delivery failed via ${mailer.name} to ${message.to}: ${lastError}`);
  return { delivered: false, provider: mailer.name, attempts, error: lastError };
}
