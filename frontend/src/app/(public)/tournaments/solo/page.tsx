// /tournaments/solo — SEO mode landing (design 45). Static route wins over
// the [slug] dynamic segment, so tournament slugs like "solo-cup" still work.
import type { Metadata } from 'next';
import { ModeLanding, MODES } from '@/components/mode-landing';
import { pageMetadata } from '@/lib/seo';

const mode = MODES[0];

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    slug: `tournaments-${mode.slug}`,
    title: 'Solo Free Fire Tournaments in Pakistan — Win PKR Prizes | CLUTCHNEX',
    description:
      'Join solo Free Fire tournaments with transparent entry fees, verified PKR prize pools, placement prizes and per-kill points. Room IDs released securely before every match.',
    path: `/tournaments/${mode.slug}`,
    keywords: 'solo free fire tournament, free fire solo tournament pakistan, FF solo entry fee, win pkr free fire',
  });
}

export default async function SoloTournamentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const allowed = ['', 'REGISTRATION_OPEN', 'LIVE', 'COMPLETED'];
  return <ModeLanding mode={mode} status={allowed.includes(status ?? '') ? (status ?? '') : ''} />;
}
