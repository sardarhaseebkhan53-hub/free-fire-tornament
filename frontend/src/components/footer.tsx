// Footer — spec §49: brand, links, legal, WhatsApp support.
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { apiServerSafe } from '@/lib/api';

export async function Footer() {
  const settings = await apiServerSafe<Record<string, unknown>>('/public/settings/public');
  const whatsapp = String(settings?.['platform.whatsappNumber'] ?? '');
  const waHref = whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, '')}` : '#';

  return (
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div>
          <p className="font-display text-lg font-bold text-fg">
            CLUTCH<span className="text-accent">NEX</span>
          </p>
          <p className="mt-1 text-xs font-semibold tracking-[0.2em] uppercase text-fg-3">
            Compete. Clutch. Conquer.
          </p>
          <p className="mt-4 max-w-xs text-sm text-fg-2">
            Pakistan&apos;s premium Free Fire tournament platform — verified prize pools,
            transparent fees, fair play.
          </p>
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-input bg-success/15 px-4 py-2 text-sm font-semibold text-success transition hover:bg-success/25"
          >
            <MessageCircle size={15} /> WhatsApp Support
          </a>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold tracking-[0.15em] uppercase text-fg-3">Platform</p>
          <ul className="space-y-2 text-sm text-fg-2">
            <li><Link className="hover:text-fg" href="/tournaments">Tournaments</Link></li>
            <li><Link className="hover:text-fg" href="/leaderboard">Leaderboard</Link></li>
            <li><Link className="hover:text-fg" href="/winners">Winners</Link></li>
            <li><Link className="hover:text-fg" href="/blog">Blog</Link></li>
            <li><Link className="hover:text-fg" href="/legal/how-it-works">How It Works</Link></li>
          </ul>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold tracking-[0.15em] uppercase text-fg-3">Support</p>
          <ul className="space-y-2 text-sm text-fg-2">
            <li><Link className="hover:text-fg" href="/support">Support Center</Link></li>
            <li><Link className="hover:text-fg" href="/legal/tournament-rules">Tournament Rules</Link></li>
            <li><Link className="hover:text-fg" href="/legal/fair-play-policy">Fair Play Policy</Link></li>
            <li><Link className="hover:text-fg" href="/legal/contact">Contact</Link></li>
          </ul>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold tracking-[0.15em] uppercase text-fg-3">Legal</p>
          <ul className="space-y-2 text-sm text-fg-2">
            <li><Link className="hover:text-fg" href="/legal/terms-of-service">Terms &amp; Conditions</Link></li>
            <li><Link className="hover:text-fg" href="/legal/privacy-policy">Privacy Policy</Link></li>
            <li><Link className="hover:text-fg" href="/legal/refund-policy">Refund Policy</Link></li>
            <li><Link className="hover:text-fg" href="/legal/responsible-play">Responsible Play</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line py-5 text-center text-xs text-fg-3">
        © {new Date().getFullYear()} CLUTCHNEX. Tournaments are skill-based competitive events —
        no guaranteed earnings. Please participate responsibly.
      </div>
    </footer>
  );
}
