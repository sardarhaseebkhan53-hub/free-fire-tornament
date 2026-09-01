// /tournaments/clash-squad-1v1 — SEO mode landing (new mode).
import type { Metadata } from 'next';
import { MODES, ModeLanding } from '@/components/mode-landing';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    slug: 'tournaments-clash-squad-1v1',
    title: 'Clash Squad 1v1 Free Fire Tournaments — Head-to-Head PKR Prizes | CLUTCHNEX',
    description: 'Clash Squad 1v1 Free Fire tournaments in Pakistan: direct solo entry, head-to-head brackets, verified PKR prize pools, secure room credentials and fast results credit.',
    path: '/tournaments/clash-squad-1v1',
    keywords: 'clash squad 1v1 tournament, free fire 1v1 pakistan, cs 1v1 FF tournament pkr, head to head FF entry',
  });
}

export default async function ClashSquad1v1Page() {
  return <ModeLanding mode={MODES.find((m) => m.slug === 'clash-squad-1v1')!} />;
}
