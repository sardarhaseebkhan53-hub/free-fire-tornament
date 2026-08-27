// Tournament discovery — spec §28: filters, search, cards. Server-driven via
// searchParams (SEO friendly, no client state needed).
import Link from 'next/link';
import { Search } from 'lucide-react';
import { apiServerSafe } from '@/lib/api';
import type { TournamentSummary } from '@/lib/types';
import { TournamentCard } from '@/components/tournament-card';
import { SectionHeading, EmptyState } from '@/components/ui';
import { pageMetadata } from '@/lib/seo';
import type { Metadata } from 'next';

const TYPE_TABS = [
  { value: '', label: 'All' },
  { value: 'SOLO', label: 'Solo' },
  { value: 'DUO', label: 'Duo' },
  { value: 'SQUAD', label: 'Squad' },
  { value: 'CLASH_SQUAD', label: 'Clash Squad' },
];
const STATUS_TABS = [
  { value: '', label: 'Any status' },
  { value: 'REGISTRATION_OPEN', label: 'Open' },
  { value: 'LIVE', label: 'Live' },
  { value: 'COMPLETED', label: 'Completed' },
];

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    slug: 'tournaments',
    title: 'Free Fire Tournaments — Solo, Duo, Squad & Clash Squad | CLUTCHNEX',
    description:
      'Browse open Free Fire tournaments in Pakistan with transparent entry fees, verified prize pools and live start countdowns.',
    path: '/tournaments',
    keywords: 'free fire tournaments, FF tournament list, join free fire tournament pakistan',
  });
}

export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const type = (sp.type ?? '').toUpperCase();
  const status = (sp.status ?? '').toUpperCase();
  const q = sp.q ?? '';

  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (q) params.set('search', q);
  params.set('limit', '12');

  const data = await apiServerSafe<{ items: TournamentSummary[]; total: number }>(
    `/public/tournaments?${params.toString()}`,
  );
  const items = data?.items ?? [];

  const tabHref = (t: string, s: string) => {
    const p = new URLSearchParams();
    if (t) p.set('type', t);
    if (s) p.set('status', s);
    if (q) p.set('q', q);
    const str = p.toString();
    return `/tournaments${str ? `?${str}` : ''}`;
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <SectionHeading
        kicker="The arena"
        title="Tournaments"
        sub="Every listing shows the full economics — entry fee, prize pool and platform fee — before you join."
      />

      {/* Filters */}
      <div className="mb-6 space-y-4">
        <form action="/tournaments" className="flex gap-3">
          {type && <input type="hidden" name="type" value={type} />}
          {status && <input type="hidden" name="status" value={status} />}
          <label className="glass flex flex-1 items-center gap-2 rounded-input px-4">
            <Search size={16} className="text-fg-3" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search tournaments…"
              className="w-full bg-transparent py-2.5 text-sm text-fg outline-none placeholder:text-fg-3"
              aria-label="Search tournaments"
            />
          </label>
          <button type="submit" className="rounded-input bg-accent px-5 text-sm font-bold text-white transition hover:bg-accent-strong">
            Search
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          {TYPE_TABS.map((t) => {
            const active = (t.value || '') === (type || '');
            return (
              <Link
                key={t.label}
                href={tabHref(t.value, status)}
                className={`rounded-pill border px-4 py-1.5 text-xs font-semibold transition ${
                  active ? 'border-accent bg-accent/15 text-accent' : 'border-line text-fg-2 hover:border-accent/40 hover:text-fg'
                }`}
              >
                {t.label}
              </Link>
            );
          })}
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
          {STATUS_TABS.map((s) => {
            const active = (s.value || '') === (status || '');
            return (
              <Link
                key={s.label}
                href={tabHref(type, s.value)}
                className={`rounded-pill border px-4 py-1.5 text-xs font-semibold transition ${
                  active ? 'border-success bg-success/15 text-success' : 'border-line text-fg-3 hover:border-success/40 hover:text-fg'
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      </div>

      <p className="mb-5 text-sm text-fg-3">
        {data ? `${data.total} tournament${data.total === 1 ? '' : 's'} found` : 'Loading…'}
      </p>

      {items.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <TournamentCard key={t.id} t={t} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No tournaments match these filters"
          sub="Try a different mode or check back soon — new arenas are scheduled every week."
        />
      )}
    </div>
  );
}
