// Login — real auth against the backend through the proxy (refresh cookie is
// set HttpOnly by the API). Spec §6 design: glass card, violet CTA.
import { AuthForm } from '@/components/auth-form';

export const metadata = {
  title: 'Login | CLUTCHNEX',
  description: 'Sign in to CLUTCHNEX — join tournaments, track results and withdraw winnings.',
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold text-fg">Welcome back</h1>
        <p className="mt-2 text-sm text-fg-2">Sign in to enter the arena.</p>
      </div>
      <div className="glass mt-8 rounded-card p-6 sm:p-8">
        <AuthForm mode="login" />
      </div>
      <p className="mt-6 text-center text-sm text-fg-3">
        New to CLUTCHNEX?{' '}
        <a href="/register" className="font-semibold text-accent hover:text-accent-strong">
          Create an account
        </a>
      </p>
    </div>
  );
}
