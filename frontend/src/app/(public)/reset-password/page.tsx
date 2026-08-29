// Set a new password via the single-use token from the reset email.
import { ResetPasswordPage } from './client';

export const metadata = {
  title: 'Reset password | CLUTCHNEX',
  description: 'Choose a new password for your CLUTCHNEX account.',
  robots: { index: false, follow: true },
};

export default function Page() {
  return <ResetPasswordPage />;
}
