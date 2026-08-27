'use client';
// Client island for the offline page — reloads when the connection is back.
export function RetryButton() {
  return (
    <button
      onClick={() => window.location.reload()}
      className="rounded-input bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-[0_4px_18px_rgba(139,92,246,0.35)] transition hover:bg-accent-strong"
    >
      Try Again
    </button>
  );
}
