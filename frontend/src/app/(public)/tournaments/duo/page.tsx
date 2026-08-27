// /tournaments/duo — SEO mode landing (design 45).
import type { Metadata } from 'next';
import { ModeLanding, MODES } from '@/components/mode-landing';
import { pageMetadata } from '@/lib/seo';

const mode = MODES[1];

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    slug: `tournaments-${mode.slug}`,
    title: 'Duo Free Fire Tournaments in Pakistan — Team up & Win PKR | CLUTCHNEX',
    description:
      'Duo Free Fire tournaments with your partner: captain registers the team, each player pays their own share, prizes split equally. Verified PKR prize pools and fair-play result checks.',
    path: `/tournaments/${mode.slug}`,
    keywords: 'duo free fire tournament, FF duo tournament pakistan, free fire team tournament, 2v2 free fire pkr',
  });
}

export default async function DuoTournamentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const allowed = ['', 'REGISTRATION_OPEN', 'LIVE', 'COMPLETED'];
  return <ModeLanding mode={mode} status={allowed.includes(status ?? '') ? (status ?? '') : ''} />;
}
