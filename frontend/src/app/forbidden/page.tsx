// 403 page (spec §21). Reached when a signed-in account lacks the role for a
// protected area. This is presentation only — every protected endpoint enforces
// authorization server-side (spec §14/§17), so this page can never be a
// security control by itself.
import Link from 'next/link';
import { ShieldX } from 'lucide-react';

export const metadata = {
  title: 'Access denied | CLUTCHNEX',
  description: 'You do not have permission to view this page.',
  robots: { index: false, follow: false },
};

export default function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
        <ShieldX size={30} />
      </span>
      <p className="mt-5 font-display text-6xl font-bold text-danger">403</p>
      <h1 className="mt-3 font-display text-2xl font-bold text-fg">You do not have access</h1>
      <p className="mt-2 text-sm text-fg-2">
        Your account does not have permission to view this area. If you believe this is a mistake,
        contact support.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/dashboard"
          className="inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white transition hover:bg-accent-strong active:scale-[0.98]"
        >
          Go to dashboard
        </Link>
        <Link
          href="/support"
          className="inline-block rounded-input border border-line px-6 py-3 text-sm font-semibold text-fg-2 transition hover:text-fg"
        >
          Contact support
        </Link>
      </div>
    </div>
  );
}
