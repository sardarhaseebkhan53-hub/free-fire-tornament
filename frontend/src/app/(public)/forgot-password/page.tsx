// Self-service password reset — request a reset link by email.
import { ForgotPasswordPage } from './client';

export const metadata = {
  title: 'Forgot password | CLUTCHNEX',
  description: 'Request a secure link to reset your CLUTCHNEX password.',
  robots: { index: false, follow: true },
};

export default function Page() {
  return <ForgotPasswordPage />;
}
