// /tournaments/clash-squad — SEO mode landing (design 45).
import type { Metadata } from 'next';
import { ModeLanding, MODES } from '@/components/mode-landing';
import { pageMetadata } from '@/lib/seo';

const mode = MODES[3];

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    slug: `tournaments-${mode.slug}`,
    title: 'Clash Squad Free Fire Tournaments — Fast 4v4 PKR Prizes | CLUTCHNEX',
    description:
      'Clash Squad Free Fire tournaments: round-based 4v4 fights, short matches, quick PKR payouts. Transparent entry fees, verified results, same-day prize credit.',
    path: `/tournaments/${mode.slug}`,
    keywords: 'clash squad tournament, free fire clash squad pakistan, CS FF tournament pkr, 4v4 clash squad entry',
  });
}

export default async function ClashSquadTournamentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const allowed = ['', 'REGISTRATION_OPEN', 'LIVE', 'COMPLETED'];
  return <ModeLanding mode={mode} status={allowed.includes(status ?? '') ? (status ?? '') : ''} />;
}
