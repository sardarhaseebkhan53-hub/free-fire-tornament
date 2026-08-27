// /tournaments/squad — SEO mode landing (design 45).
import type { Metadata } from 'next';
import { ModeLanding, MODES } from '@/components/mode-landing';
import { pageMetadata } from '@/lib/seo';

const mode = MODES[2];

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    slug: `tournaments-${mode.slug}`,
    title: 'Squad Free Fire Tournaments (4v4) in Pakistan — Win PKR | CLUTCHNEX',
    description:
      'Full-squad 4v4 Free Fire tournaments: register your squad, verified FF UIDs, placement prizes, capped kill pools and MVP awards — all published before you join.',
    path: `/tournaments/${mode.slug}`,
    keywords: 'squad free fire tournament, 4v4 FF tournament pakistan, free fire squad entry, clan tournament pkr',
  });
}

export default async function SquadTournamentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const allowed = ['', 'REGISTRATION_OPEN', 'LIVE', 'COMPLETED'];
  return <ModeLanding mode={mode} status={allowed.includes(status ?? '') ? (status ?? '') : ''} />;
}
