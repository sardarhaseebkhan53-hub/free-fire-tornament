// =============================================================================
// Email provider abstraction.
//
// DEV: messages are logged to the console (the verification/reset links are
// usable directly). Production: plug a transactional provider (SMTP/SES/
// Resend/…) behind sendMail() without touching call sites. The auth flows
// never depend on delivery succeeding — tokens remain valid server-side.
// =============================================================================
import { env, isProd } from '../lib/env';

export interface Mail {
  to: string;
  subject: string;
  html: string;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (!isProd) {
    console.log(
      `[email:dev] to=${mail.to} subject="${mail.subject}"\n${mail.html}\n`,
    );
    return;
  }
  // TODO(phase-15): wire the configured transactional provider here.
  console.warn('[email] provider not configured in production; mail skipped', mail.to);
}

export function verificationEmail(to: string, token: string) {
  const link = `${env.PUBLIC_URL}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Verify your CLUTCHNEX account',
    html: `<p>Welcome to CLUTCHNEX — the arena is calling.</p><p><a href="${link}">Click here to verify your email</a> (valid 24 hours).</p>`,
  };
}

export function passwordResetEmail(to: string, token: string) {
  const link = `${env.PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Reset your CLUTCHNEX password',
    html: `<p>We received a password reset request for your account.</p><p><a href="${link}">Reset your password</a> (valid 1 hour). If this was not you, ignore this email.</p>`,
  };
}
