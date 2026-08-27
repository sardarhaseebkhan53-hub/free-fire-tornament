// Support center — FAQs + ticket + WhatsApp escalation (tickets UI is wired
// in Phase 11; here users get every real, working support channel).
import Link from 'next/link';
import { LifeBuoy, MessageCircle, Ticket } from 'lucide-react';
import { apiServerSafe } from '@/lib/api';
import type { Faq } from '@/lib/types';
import { SectionHeading } from '@/components/ui';
import { FaqList } from '@/components/faq-list';

export const metadata = {
  title: 'Support Center',
  description: 'Get help with payments, tournaments, withdrawals and accounts on CLUTCHNEX.',
};

export default async function SupportPage() {
  const [faqs, settings] = await Promise.all([
    apiServerSafe<Faq[]>('/public/faqs'),
    apiServerSafe<Record<string, unknown>>('/public/settings/public'),
  ]);
  const whatsapp = String(settings?.['platform.whatsappNumber'] ?? '');
  const email = String(settings?.['platform.supportEmail'] ?? 'support@clutchnex.gg');

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <SectionHeading
        kicker="We have your back"
        title="Support Center"
        sub="Payments, tournaments, withdrawals, teams — whatever it is, there is a fast path to a human."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {whatsapp && (
          <a
            href={`https://wa.me/${whatsapp.replace(/\D/g, '')}`}
            target="_blank"
            rel="noreferrer"
            className="glass rounded-card p-6 transition hover:border-success/40"
          >
            <MessageCircle size={22} className="text-success" />
            <h2 className="mt-3 font-display text-base font-bold text-fg">WhatsApp</h2>
            <p className="mt-1 text-sm text-fg-2">Fastest — chat with support now.</p>
          </a>
        )}
        <Link href="/support/tickets" className="glass rounded-card p-6 transition hover:border-accent/40">
          <Ticket size={22} className="text-accent" />
          <h2 className="mt-3 font-display text-base font-bold text-fg">Open a Ticket</h2>
          <p className="mt-1 text-sm text-fg-2">Track payment or tournament issues to resolution — right in your account.</p>
        </Link>
        <a href={`mailto:${email}`} className="glass rounded-card p-6 transition hover:border-info/40">
          <LifeBuoy size={22} className="text-info" />
          <h2 className="mt-3 font-display text-base font-bold text-fg">Email</h2>
          <p className="mt-1 text-sm text-fg-2">{email}</p>
        </a>
      </div>

      <div className="mt-12">
        <SectionHeading kicker="Instant answers" title="FAQ" />
        <FaqList faqs={faqs ?? []} />
      </div>
    </div>
  );
}
