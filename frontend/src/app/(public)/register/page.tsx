// Register — spec §7 fields, real backend validation errors shown inline.
import { AuthForm } from '@/components/auth-form';

export const metadata = {
  title: 'Create Account',
  description: 'Join CLUTCHNEX — Free Fire tournaments with verified prize pools.',
};

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold text-fg">Join the arena</h1>
        <p className="mt-2 text-sm text-fg-2">
          Create your account, link your Free Fire identity, start competing.
        </p>
      </div>
      <div className="glass mt-8 rounded-card p-6 sm:p-8">
        <AuthForm mode="register" />
      </div>
      <p className="mt-6 text-center text-sm text-fg-3">
        Already registered?{' '}
        <a href="/login" className="font-semibold text-accent hover:text-accent-strong">
          Sign in
        </a>
      </p>
    </div>
  );
}
