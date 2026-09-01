// /tournaments/lone-wolf — SEO mode landing (new mode).
import type { Metadata } from 'next';
import { MODES, ModeLanding } from '@/components/mode-landing';
import { pageMetadata } from '@/lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    slug: 'tournaments-lone-wolf',
    title: 'Lone Wolf Free Fire Tournaments — Solo PKR Prizes | CLUTCHNEX',
    description: 'Lone Wolf Free Fire tournaments in Pakistan: solo-entry rounds, no team needed, transparent entry fees, verified PKR prizes and automatic wallet credit after verified results.',
    path: '/tournaments/lone-wolf',
    keywords: 'lone wolf tournament, free fire lone wolf pakistan, solo FF tournament pkr, lone wolf entry',
  });
}

export default async function LoneWolfPage() {
  return <ModeLanding mode={MODES.find((m) => m.slug === 'lone-wolf')!} />;
}
