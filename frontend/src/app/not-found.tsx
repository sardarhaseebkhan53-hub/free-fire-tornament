import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="font-display text-6xl font-bold text-accent">404</p>
      <h1 className="mt-3 font-display text-2xl font-bold text-fg">This zone is off the map</h1>
      <p className="mt-2 text-sm text-fg-2">The page you are looking for does not exist or was moved.</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-input bg-accent px-6 py-3 text-sm font-bold text-white transition hover:bg-accent-strong"
      >
        Back to the arena
      </Link>
    </div>
  );
}
