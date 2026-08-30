'use client';
// 500 error boundary (spec §21). Deliberately shows a friendly message only —
// never a stack trace, database error, token or any internal detail. Next.js
// already strips the message in production builds; we do not render `error`
// text at all, and surface only the non-sensitive `digest` so a user can quote
// it to support.
import Link from 'next/link';
import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client-side breadcrumb only. Server logs hold the real detail.
    if (process.env.NODE_ENV === 'development') console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="font-display text-6xl font-bold text-danger">500</p>
      <h1 className="mt-3 font-display text-2xl font-bold text-fg">Something broke on our end</h1>
      <p className="mt-2 text-sm text-fg-2">
        This one is on us, not you. The team has been alerted — try again in a moment.
      </p>
      {error.digest && (
        <p className="mt-3 text-[11px] text-fg-3">
          Reference code: <span className="tabular font-semibold text-fg-2">{error.digest}</span>
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-input bg-accent px-6 py-3 text-sm font-bold text-white transition hover:bg-accent-strong active:scale-[0.98]"
        >
          <RefreshCw size={15} /> Try again
        </button>
        <Link
          href="/"
          className="inline-block rounded-input border border-line px-6 py-3 text-sm font-semibold text-fg-2 transition hover:text-fg"
        >
          Back to the arena
        </Link>
      </div>
    </div>
  );
}
