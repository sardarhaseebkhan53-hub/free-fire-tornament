// =============================================================================
// Email — verification and password-reset messages.
//
// Delivery is delegated to src/lib/mailer.ts (log / smtp / resend / postmark),
// configured entirely through env. Two invariants hold here:
//
//   1. Auth flows never fail because mail did. A token is valid server-side
//      whether or not the message lands, and the player can request a resend.
//   2. Nothing is thrown to the caller — the outcome is returned and logged, so
//      a misconfigured provider shows up in the logs instead of as a 500 on
//      the registration endpoint.
// =============================================================================
import { env, isProd } from '../lib/env';
import { buildMailer, deliver, type Mailer, type MailerConfig, type MailerResult } from '../lib/mailer';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

function mailerConfig(): MailerConfig {
  return {
    provider: env.EMAIL_PROVIDER,
    from: env.EMAIL_FROM,
    replyTo: env.EMAIL_REPLY_TO,
    timeoutMs: env.EMAIL_TIMEOUT_MS,
    attempts: env.EMAIL_ATTEMPTS,
    smtp: env.SMTP_HOST
      ? {
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        }
      : undefined,
    resendApiKey: env.RESEND_API_KEY,
    postmarkServerToken: env.POSTMARK_SERVER_TOKEN,
  };
}

// Built once; a bad configuration throws at first use rather than per request.
let cached: Mailer | null = null;

export function getMailer(): Mailer {
  if (!cached) cached = buildMailer(mailerConfig());
  return cached;
}

/** Test seam: swap the transport without touching the network. */
export function setMailerForTests(mailer: Mailer | null): void {
  cached = mailer;
}

/**
 * Send a message. Resolves with the delivery outcome; never rejects.
 */
export async function sendMail(mail: Mail): Promise<MailerResult> {
  let mailer: Mailer;
  try {
    mailer = getMailer();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[email] provider not usable (${msg}); message to ${mail.to} not sent`);
    return { delivered: false, provider: env.EMAIL_PROVIDER, attempts: 0, error: msg };
  }
  return deliver(mailer, mail, { attempts: mailerConfig().attempts });
}

/** Where the mail went, for the development response payload. */
export function mailProviderName(): string {
  return isProd ? env.EMAIL_PROVIDER : 'log';
}

// --- templates ---------------------------------------------------------------

const shell = (body: string) => `
<div style="font-family:Inter,system-ui,sans-serif;background:#0b0d17;padding:24px;color:#e6e8f2">
  <div style="max-width:520px;margin:0 auto;background:#12152a;border:1px solid #262b45;border-radius:16px;padding:28px">
    <p style="margin:0 0 18px;font-weight:700;letter-spacing:.08em;color:#a78bfa">CLUTCHNEX</p>
    ${body}
    <p style="margin:22px 0 0;font-size:12px;color:#8a90b4">
      COMPETE. CLUTCH. CONQUER. — If you did not request this, you can ignore it.
    </p>
  </div>
</div>`.trim();

export function verificationEmail(to: string, token: string): Mail {
  const link = `${env.PUBLIC_URL}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Verify your CLUTCHNEX account',
    html: shell(
      `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">Welcome to CLUTCHNEX — the arena is calling.</p>
       <p style="margin:0 0 20px">
         <a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700">Verify your email</a>
       </p>
       <p style="margin:0;font-size:12px;color:#8a90b4">Link valid for 24 hours. Or paste: ${link}</p>`,
    ),
    text: `Welcome to CLUTCHNEX. Verify your email: ${link} (valid 24 hours).`,
  };
}

export function passwordResetEmail(to: string, token: string): Mail {
  const link = `${env.PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Reset your CLUTCHNEX password',
    html: shell(
      `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">We received a password reset request for your account.</p>
       <p style="margin:0 0 20px">
         <a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700">Reset your password</a>
       </p>
       <p style="margin:0;font-size:12px;color:#8a90b4">Link valid for 30 minutes. If this was not you, ignore this email. Or paste: ${link}</p>`,
    ),
    text: `Reset your CLUTCHNEX password: ${link} (valid 30 minutes). If this was not you, ignore this email.`,
  };
}

/**
 * Security alert sent AFTER a password changes (reset flow or in-app change).
 * Spec §6.17 / §15: the account owner must always be told out-of-band, so a
 * silent takeover is impossible — if they did not do this, they find out.
 * Contains no token and no link that can change credentials.
 */
export function passwordChangedEmail(to: string, ctx: { ip?: string; at?: Date } = {}): Mail {
  const when = (ctx.at ?? new Date()).toUTCString();
  const from = ctx.ip ? ` from IP ${ctx.ip}` : '';
  return {
    to,
    subject: 'Your CLUTCHNEX password was changed',
    html: shell(
      `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">Your account password was changed on <strong>${when}</strong>${from}.</p>
       <p style="margin:0 0 14px;font-size:15px;line-height:1.6">All other sessions have been signed out. If you made this change, no action is needed.</p>
       <p style="margin:0;font-size:13px;color:#f5b942"><strong>If this was NOT you</strong>, reset your password immediately and contact support — your account may be compromised.</p>`,
    ),
    text: `Your CLUTCHNEX password was changed on ${when}${from}. All other sessions were signed out. If this was not you, reset your password immediately and contact support.`,
  };
}
